package knife4x

import (
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
)

// BasicAuthConfig protects Knife4x resources and configured local spec paths.
// Credentials are copied at construction and are never sent to browser config.
// Use HTTPS at the public endpoint. Absolute spec URLs need their own protection.
type BasicAuthConfig struct {
	Username string
	Password string
	Realm    string
}

type basicAuth struct {
	username  [sha256.Size]byte
	password  [sha256.Size]byte
	challenge string
	specPaths []string
}

func newBasicAuth(cfg *BasicAuthConfig, browser browserConfig) (*basicAuth, error) {
	if cfg == nil {
		return nil, nil
	}
	if cfg.Username == "" || cfg.Password == "" || strings.Contains(cfg.Username, ":") {
		return nil, fmt.Errorf("knife4x: BasicAuth requires a non-empty username without colon and non-empty password")
	}
	realm := cfg.Realm
	if realm == "" {
		realm = "Knife4x"
	}
	for _, char := range realm {
		if char < 0x20 || char > 0x7e {
			return nil, fmt.Errorf("knife4x: BasicAuth.Realm must contain only printable ASCII")
		}
	}
	auth := &basicAuth{
		username:  sha256.Sum256([]byte(cfg.Username)),
		password:  sha256.Sum256([]byte(cfg.Password)),
		challenge: `Basic realm="` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(realm) + `", charset="UTF-8"`,
	}
	values := []string{browser.SpecURL}
	if len(browser.Specs) != 0 {
		values = values[:0]
		for _, spec := range browser.Specs {
			values = append(values, spec.URL)
		}
	}
	base, err := url.Parse("http://knife4x.invalid" + strings.TrimRight(browser.BasePath, "/") + "/")
	if err != nil {
		return nil, fmt.Errorf("knife4x: invalid BasePath for BasicAuth: %w", err)
	}
	normalizeBrowserDots(base)
	for _, value := range values {
		if strings.Contains(value, `\`) {
			return nil, fmt.Errorf("knife4x: BasicAuth spec URLs must not contain backslashes")
		}
		spec, _ := url.Parse(value) // Config validation has already parsed every URL.
		if spec.IsAbs() {
			continue
		}
		normalizeBrowserDots(spec)
		auth.specPaths = append(auth.specPaths, canonicalAuthPath(base.ResolveReference(spec).Path))
	}
	return auth, nil
}

// WHATWG treats percent-encoded single/double-dot segments as traversal before
// resolving a relative URL. net/url otherwise removes literal parent segments
// first, potentially authorizing a different path from the browser request.
// https://url.spec.whatwg.org/#double-dot-url-path-segment
func normalizeBrowserDots(value *url.URL) {
	segments := strings.Split(value.EscapedPath(), "/")
	for i, segment := range segments {
		dots := strings.ReplaceAll(strings.ToLower(segment), "%2e", ".")
		if dots == "." || dots == ".." {
			segments[i] = dots
		}
	}
	value.RawPath = strings.Join(segments, "/")
	value.Path, _ = url.PathUnescape(value.RawPath) // The URL was already validated.
}

func (a *basicAuth) authorize(w http.ResponseWriter, r *http.Request) bool {
	username, password, ok := r.BasicAuth()
	usernameHash := sha256.Sum256([]byte(username))
	passwordHash := sha256.Sum256([]byte(password))
	userMatch := subtle.ConstantTimeCompare(usernameHash[:], a.username[:])
	passwordMatch := subtle.ConstantTimeCompare(passwordHash[:], a.password[:])
	if ok && userMatch&passwordMatch == 1 {
		return true
	}
	w.Header().Set("WWW-Authenticate", a.challenge)
	http.Error(w, "Unauthorized", http.StatusUnauthorized)
	return false
}

func (h *handler) requiresAuth(requestPath string) bool {
	canonical := canonicalAuthPath(requestPath)
	for _, specPath := range h.auth.specPaths {
		if canonical == specPath || (specPath != "/" && strings.HasPrefix(canonical, specPath+"/")) {
			return true
		}
	}
	name, ok := h.relativePath(canonical)
	if !ok || !fs.ValidPath(name) {
		return false
	}
	if name == "doc.html" {
		return true
	}
	info, err := fs.Stat(h.files, name)
	return err == nil && info.Mode().IsRegular()
}

// Enforce cache isolation when headers are committed, including next handlers
// that would otherwise opt a local spec into shared caching. Unwrap lets the
// standard http.ResponseController reach the original writer.
type privateResponseWriter struct {
	http.ResponseWriter
}

func (w *privateResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *privateResponseWriter) WriteHeader(status int) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.ResponseWriter.WriteHeader(status)
}

func (w *privateResponseWriter) Write(data []byte) (int, error) {
	w.Header().Set("Cache-Control", "private, no-store")
	return w.ResponseWriter.Write(data)
}

func (w *privateResponseWriter) FlushError() error {
	w.Header().Set("Cache-Control", "private, no-store")
	return http.NewResponseController(w.ResponseWriter).Flush()
}

func (w *privateResponseWriter) Flush() {
	_ = w.FlushError()
}

// Match the forms commonly normalized by routers before authorizing a request.
// Do not rewrite the request: business routing remains entirely owned by next.
func canonicalAuthPath(value string) string {
	segments := strings.Split(strings.ReplaceAll(value, `\`, "/"), "/")
	for i, segment := range segments {
		if index := strings.IndexByte(segment, ';'); index >= 0 {
			segments[i] = segment[:index]
		}
	}
	return path.Clean("/" + strings.Join(segments, "/"))
}
