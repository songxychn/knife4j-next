// Package knife4x serves the embedded Knife4x OpenAPI console.
package knife4x

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

const (
	staticRoot       = "internal/ui/static"
	indexFile        = "index.html"
	moduleScriptMark = `<script type="module"`
	configAssignment = "window.__KNIFE4X_CONFIG__="
)

//go:embed internal/ui/static
var embeddedUI embed.FS

// Config controls how the embedded console starts.
type Config struct {
	// SpecURL selects one document and is mutually exclusive with Specs.
	SpecURL  string
	BasePath string
	// Specs configures an ordered, static list of named OpenAPI documents.
	Specs []Spec
	// Disabled bypasses all document configuration and returns next unchanged.
	// It does not disable OpenAPI routes owned by next.
	Disabled bool
	// BasicAuth protects the UI and configured local spec paths. Absolute HTTP(S)
	// spec URLs are served by their own host and are outside this protection.
	BasicAuth *BasicAuthConfig
	// UISettings supplies defaults below spec settings and browser preferences.
	UISettings *UISettings
	// Documents adds Markdown content to the shared document-management UI.
	Documents []MarkdownDocument
}

type browserConfig struct {
	SpecURL   string            `json:"specUrl,omitempty"`
	BasePath  string            `json:"basePath"`
	Specs     []Spec            `json:"specs,omitempty"`
	Settings  *UISettings       `json:"settings,omitempty"`
	Documents []browserDocument `json:"documents,omitempty"`
}

type handler struct {
	basePath string
	index    []byte
	files    fs.FS
	server   http.Handler
	next     http.Handler
	auth     *basicAuth
}

// NewHandler creates a framework-independent Knife4x HTTP handler.
func NewHandler(cfg Config, next http.Handler) (http.Handler, error) {
	if next == nil {
		next = http.NotFoundHandler()
	}
	if cfg.Disabled {
		return next, nil
	}
	basePath, err := normalizeBasePath(cfg.BasePath)
	if err != nil {
		return nil, err
	}
	browser, err := prepareBrowserConfig(cfg, basePath)
	if err != nil {
		return nil, err
	}
	auth, err := newBasicAuth(cfg.BasicAuth, browser)
	if err != nil {
		return nil, err
	}

	files, err := fs.Sub(embeddedUI, staticRoot)
	if err != nil {
		return nil, fmt.Errorf("knife4x: open embedded UI: %w", err)
	}
	index, err := fs.ReadFile(files, indexFile)
	if err != nil {
		return nil, fmt.Errorf("knife4x: read embedded %s: %w", indexFile, err)
	}
	mark := bytes.Index(index, []byte(moduleScriptMark))
	if mark < 0 {
		return nil, fmt.Errorf("knife4x: embedded %s has no module script", indexFile)
	}

	configJSON, err := json.Marshal(browser)
	if err != nil {
		return nil, fmt.Errorf("knife4x: encode browser config: %w", err)
	}
	injected := make([]byte, 0, len(index)+len(configJSON)+64)
	injected = append(injected, index[:mark]...)
	injected = append(injected, "<script>"+configAssignment...)
	injected = append(injected, configJSON...)
	injected = append(injected, ";</script>\n    "...)
	injected = append(injected, index[mark:]...)

	return &handler{
		basePath: basePath,
		index:    injected,
		files:    files,
		server:   http.FileServerFS(files),
		next:     next,
		auth:     auth,
	}, nil
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.auth != nil && h.requiresAuth(r.URL.Path) {
		w = &privateResponseWriter{ResponseWriter: w}
		w.Header().Set("Cache-Control", "private, no-store")
		defer w.Header().Set("Cache-Control", "private, no-store")
		if !h.auth.authorize(w, r) {
			return
		}
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.next.ServeHTTP(w, r)
		return
	}

	name, ok := h.relativePath(r.URL.Path)
	if !ok || !fs.ValidPath(name) || name == indexFile {
		h.next.ServeHTTP(w, r)
		return
	}
	if name == "doc.html" {
		http.ServeContent(w, r, "doc.html", time.Time{}, bytes.NewReader(h.index))
		return
	}

	info, err := fs.Stat(h.files, name)
	if err != nil || !info.Mode().IsRegular() {
		h.next.ServeHTTP(w, r)
		return
	}

	request := r.Clone(r.Context())
	request.URL.Path = "/" + name
	request.URL.RawPath = ""
	h.server.ServeHTTP(w, request)
}

func (h *handler) relativePath(requestPath string) (string, bool) {
	if h.basePath == "/" {
		if !strings.HasPrefix(requestPath, "/") {
			return "", false
		}
		return strings.TrimPrefix(requestPath, "/"), true
	}

	prefix := h.basePath + "/"
	if !strings.HasPrefix(requestPath, prefix) {
		return "", false
	}
	return strings.TrimPrefix(requestPath, prefix), true
}

func normalizeSpecURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("knife4x: SpecURL must not be empty")
	}
	if strings.HasPrefix(value, "//") {
		return "", fmt.Errorf("knife4x: SpecURL must not be protocol-relative")
	}
	if strings.Contains(value, `\`) {
		return "", fmt.Errorf("knife4x: SpecURL must not contain backslashes")
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("knife4x: invalid SpecURL: %w", err)
	}
	if parsed.User != nil {
		return "", fmt.Errorf("knife4x: SpecURL must not contain credentials")
	}
	if parsed.IsAbs() {
		if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return "", fmt.Errorf("knife4x: SpecURL must use HTTP(S)")
		}
	} else if parsed.Host != "" {
		return "", fmt.Errorf("knife4x: SpecURL must not be protocol-relative")
	}
	return value, nil
}

func normalizeBasePath(value string) (string, error) {
	if value == "" {
		return "/", nil
	}
	if strings.TrimSpace(value) != value ||
		!strings.HasPrefix(value, "/") ||
		strings.HasPrefix(value, "//") ||
		strings.ContainsAny(value, "?#\\") {
		return "", fmt.Errorf("knife4x: BasePath must be a clean absolute URL path")
	}

	value = strings.TrimRight(value, "/")
	if value == "" {
		return "/", nil
	}
	if path.Clean(value) != value {
		return "", fmt.Errorf("knife4x: BasePath must be a clean absolute URL path")
	}
	return value, nil
}
