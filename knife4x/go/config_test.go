package knife4x

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
)

func TestConfigRejectsInvalidNewOptions(t *testing.T) {
	t.Parallel()
	inlineFS := fstest.MapFS{"guide.md": &fstest.MapFile{Data: []byte("guide")}}
	tests := []struct {
		name string
		cfg  Config
	}{
		{"both spec forms", Config{SpecURL: "/spec.json", Specs: []Spec{{Name: "a", URL: "/a.json"}}}},
		{"empty spec list", Config{Specs: []Spec{}}},
		{"empty spec name", Config{Specs: []Spec{{Name: "  ", URL: "/a.json"}}}},
		{"duplicate normalized spec names", Config{Specs: []Spec{{Name: "a", URL: "/a.json"}, {Name: " a ", URL: "/b.json"}}}},
		{"slash in name", Config{Specs: []Spec{{Name: "a/b", URL: "/a.json"}}}},
		{"backslash in name", Config{Specs: []Spec{{Name: `a\b`, URL: "/a.json"}}}},
		{"query in name", Config{Specs: []Spec{{Name: "a?b", URL: "/a.json"}}}},
		{"fragment in name", Config{Specs: []Spec{{Name: "a#b", URL: "/a.json"}}}},
		{"percent in name", Config{Specs: []Spec{{Name: "a%2Fb", URL: "/a.json"}}}},
		{"control in name", Config{Specs: []Spec{{Name: "a\x00b", URL: "/a.json"}}}},
		{"dot name", Config{Specs: []Spec{{Name: ".", URL: "/a.json"}}}},
		{"dot dot name", Config{Specs: []Spec{{Name: "..", URL: "/a.json"}}}},
		{"reserved group name", Config{Specs: []Spec{{Name: "group", URL: "/a.json"}}}},
		{"invalid named spec URL", Config{Specs: []Spec{{Name: "a", URL: "//example.com/spec.json"}}}},
		{"spec URL credentials", Config{Specs: []Spec{{Name: "a", URL: "https://user:pass@example.com/spec.json"}}}},
		{"backslash spec URL", Config{Specs: []Spec{{Name: "a", URL: `/specs\openapi.json`}}}},
		{"browser network-path spec URL", Config{Specs: []Spec{{Name: "a", URL: `/\remote.example.test/openapi.json`}}}},
		{"empty document title", Config{SpecURL: "/a.json", Documents: []MarkdownDocument{{Title: " "}}}},
		{"file without filesystem", Config{SpecURL: "/a.json", Documents: []MarkdownDocument{{Title: "Guide", Path: "guide.md"}}}},
		{"filesystem without file", Config{SpecURL: "/a.json", Documents: []MarkdownDocument{{Title: "Guide", FS: inlineFS}}}},
		{"file and content", Config{SpecURL: "/a.json", Documents: []MarkdownDocument{{Title: "Guide", Content: "inline", FS: inlineFS, Path: "guide.md"}}}},
		{"file escapes FS", Config{SpecURL: "/a.json", Documents: []MarkdownDocument{{Title: "Guide", FS: inlineFS, Path: "../guide.md"}}}},
		{"missing file", Config{SpecURL: "/a.json", Documents: []MarkdownDocument{{Title: "Guide", FS: inlineFS, Path: "missing.md"}}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewHandler(test.cfg, nil); err == nil {
				t.Fatal("NewHandler() error = nil, want validation error")
			}
		})
	}
}

func TestNamedSpecsSettingsAndDocumentsBootstrap(t *testing.T) {
	t.Parallel()
	enabled, disabled := true, false
	malicious := `</script><script>alert("unsafe")</script>`
	docFS := fstest.MapFS{"guides/intro.md": &fstest.MapFile{Data: []byte("# Embedded guide")}}
	cfg := Config{
		BasePath: "/internal",
		Specs: []Spec{
			{Name: "  用户中心  ", URL: "users.json"},
			{Name: "orders", URL: "https://api.example.test/openapi.json"},
		},
		UISettings: &UISettings{
			Language: "ja-JP", EnableDebug: &disabled, EnableSearch: &enabled,
			EnableCustomHome: &enabled, HomeMarkdown: malicious,
		},
		Documents: []MarkdownDocument{
			{Title: "  Introduction  ", FS: docFS, Path: "guides/intro.md"},
			{Title: malicious, Content: malicious},
			{Title: "Empty document"},
		},
	}
	got, err := NewHandler(cfg, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	// Configuration is snapshotted, including filesystem content.
	docFS["guides/intro.md"].Data = []byte("changed after construction")
	cfg.Specs[0].Name = "changed after construction"
	doc := request(t, got, http.MethodGet, "/internal/doc.html", http.StatusOK)
	if strings.Contains(doc.Body.String(), malicious) || strings.Contains(doc.Body.String(), "guides/intro.md") {
		t.Fatal("HTML contains a raw script terminator or internal filesystem path")
	}
	config := readBrowserConfig(t, doc.Body.String())
	if config.SpecURL != "" || config.BasePath != "/internal" {
		t.Fatalf("unexpected config: %#v", config)
	}
	wantSpecs := []Spec{{Name: "用户中心", URL: "users.json"}, {Name: "orders", URL: "https://api.example.test/openapi.json"}}
	if !reflect.DeepEqual(config.Specs, wantSpecs) {
		t.Fatalf("Specs = %#v, want %#v", config.Specs, wantSpecs)
	}
	if config.Settings.Language != "ja-JP" || config.Settings.EnableDebug == nil || *config.Settings.EnableDebug || config.Settings.EnableSearch == nil || !*config.Settings.EnableSearch || config.Settings.HomeMarkdown != malicious {
		t.Fatalf("unexpected settings: %#v", config.Settings)
	}
	wantDocuments := []browserDocument{{Title: "Introduction", Content: "# Embedded guide"}, {Title: malicious, Content: malicious}, {Title: "Empty document", Content: ""}}
	if !reflect.DeepEqual(config.Documents, wantDocuments) {
		t.Fatalf("Documents = %#v, want %#v", config.Documents, wantDocuments)
	}
}

func TestUISettingsPassesLanguagePreferenceThroughToUI(t *testing.T) {
	t.Parallel()
	for _, language := range []string{"en-GB", "fr-FR"} {
		t.Run(language, func(t *testing.T) {
			handler, err := NewHandler(Config{
				SpecURL:    "/openapi.json",
				UISettings: &UISettings{Language: language},
			}, nil)
			if err != nil {
				t.Fatalf("NewHandler() error = %v", err)
			}
			doc := request(t, handler, http.MethodGet, "/doc.html", http.StatusOK)
			config := readBrowserConfig(t, doc.Body.String())
			if config.Settings == nil || config.Settings.Language != language {
				t.Fatalf("settings = %#v, want language %q", config.Settings, language)
			}
		})
	}
}

func TestDisabledBypassesDocumentConfigurationAndKeepsHostRoutes(t *testing.T) {
	t.Parallel()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(nextStatus) })
	got, err := NewHandler(Config{
		Disabled:  true,
		BasePath:  "bad path",
		BasicAuth: &BasicAuthConfig{},
		Documents: []MarkdownDocument{{Title: "Missing", FS: fstest.MapFS{}, Path: "missing.md"}},
	}, next)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	for _, target := range []string{"/doc.html", "/assets/index.js", "/openapi.json", "/api/ping"} {
		request(t, got, http.MethodGet, target, nextStatus)
	}
	got, err = NewHandler(Config{Disabled: true}, nil)
	if err != nil {
		t.Fatalf("disabled with nil next: %v", err)
	}
	request(t, got, http.MethodGet, "/doc.html", http.StatusNotFound)
}

func readBrowserConfig(t *testing.T, body string) browserConfig {
	t.Helper()
	start := strings.Index(body, configAssignment)
	if start < 0 {
		t.Fatal("missing browser config")
	}
	start += len(configAssignment)
	end := strings.Index(body[start:], ";</script>")
	if end < 0 {
		t.Fatal("missing browser config terminator")
	}
	var config browserConfig
	if err := json.Unmarshal([]byte(body[start:start+end]), &config); err != nil {
		t.Fatalf("decode browser config: %v", err)
	}
	return config
}

func TestBasicAuthValidatesConfiguration(t *testing.T) {
	t.Parallel()
	for _, config := range []BasicAuthConfig{
		{}, {Username: "user"}, {Password: "secret"}, {Username: "a:b", Password: "secret"},
		{Username: "user", Password: "secret", Realm: "header\r\ninjection"},
		{Username: "user", Password: "secret", Realm: "non-ascii-中文"},
	} {
		if _, err := NewHandler(Config{SpecURL: "/openapi.json", BasicAuth: &config}, nil); err == nil {
			t.Fatal("NewHandler() error = nil for invalid BasicAuth")
		}
	}
}

func TestBasicAuthProtectsAllEmbeddedFilesAndConfiguredLocalSpecs(t *testing.T) {
	t.Parallel()
	for _, basePath := range []string{"", "/internal"} {
		t.Run(basePath, func(t *testing.T) {
			const username = "knife4x-test-reader-71e4"
			const credential = "knife4x-test-secret-71e4"
			auth := &BasicAuthConfig{Username: username, Password: credential, Realm: `Docs "private"\realm`}
			got, err := NewHandler(Config{
				BasePath: basePath,
				Specs: []Spec{
					{Name: "relative", URL: "openapi.json?version=1"},
					{Name: "root", URL: "/specs/root.json"},
					{Name: "external", URL: "https://remote.example.test/remote.json"},
				},
				BasicAuth: auth,
			}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(nextStatus) }))
			if err != nil {
				t.Fatalf("NewHandler() error = %v", err)
			}
			// Mutating the caller's config cannot alter authentication.
			auth.Username, auth.Password = "changed", "changed"
			paths := []string{basePath + "/doc.html", basePath + "/openapi.json", "/specs/root.json"}
			files, err := fs.Sub(embeddedUI, staticRoot)
			if err != nil {
				t.Fatal(err)
			}
			if err := fs.WalkDir(files, ".", func(name string, entry fs.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if !entry.IsDir() {
					paths = append(paths, basePath+"/"+name)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			for _, target := range paths {
				for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost} {
					response := request(t, got, method, target, http.StatusUnauthorized)
					if response.Header().Get("WWW-Authenticate") != `Basic realm="Docs \"private\"\\realm", charset="UTF-8"` || response.Header().Get("Cache-Control") != "private, no-store" {
						t.Fatalf("invalid auth challenge: %#v", response.Header())
					}
				}
			}
			for _, target := range []string{
				basePath + "/doc.html", basePath + "/assets/index.js", basePath + "/oauth2-redirect.html",
				basePath + "/openapi.json?version=2", "/specs/root.json",
			} {
				want := http.StatusOK
				if strings.Contains(target, "openapi.json") || strings.Contains(target, "root.json") {
					want = nextStatus
				}
				response := authenticatedRequest(got, http.MethodGet, target, username, credential)
				if response.Code != want {
					t.Fatalf("authorized GET %s status = %d, want %d", target, response.Code, want)
				}
				if strings.Contains(response.Body.String(), credential) || strings.Contains(response.Body.String(), username) {
					t.Fatal("browser response contains credentials")
				}
			}
			for _, pair := range [][2]string{{username, "wrong"}, {"wrong", credential}, {"", ""}} {
				if got := authenticatedRequest(got, http.MethodGet, basePath+"/doc.html", pair[0], pair[1]); got.Code != http.StatusUnauthorized {
					t.Fatalf("invalid credentials returned %d", got.Code)
				}
			}
			for _, test := range []struct {
				method string
				target string
				status int
			}{
				{http.MethodHead, basePath + "/doc.html", http.StatusOK},
				{http.MethodPost, basePath + "/doc.html", nextStatus},
				{http.MethodHead, basePath + "/openapi.json", nextStatus},
				{http.MethodPost, basePath + "/openapi.json", nextStatus},
			} {
				if response := authenticatedRequest(got, test.method, test.target, username, credential); response.Code != test.status {
					t.Fatalf("authorized %s %s status = %d, want %d", test.method, test.target, response.Code, test.status)
				}
			}
			for _, target := range []string{"/api/ping", "/remote.json", "/specs/root.json-other"} {
				request(t, got, http.MethodGet, target, nextStatus)
			}
		})
	}
}

func TestBasicAuthMatchesCommonRouterPathAliasesBeforePassThrough(t *testing.T) {
	t.Parallel()
	got, err := NewHandler(Config{
		BasePath:  "/internal",
		SpecURL:   "/specs/openapi.json",
		BasicAuth: &BasicAuthConfig{Username: "user", Password: "secret"},
	}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(nextStatus)
		_, _ = w.Write([]byte(r.URL.RequestURI()))
	}))
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{
		"/internal//doc.html", "/internal/./doc.html", "/internal/doc.html;param=1",
		"/specs/openapi.json/extra", "/specs/openapi.json;param=1", "/specs/openapi.json%3Bparam=1",
		"/specs%2Fopenapi.json", "/specs/../specs/openapi.json", "/specs/;param/openapi.json",
		"/specs%5Copenapi.json", "/internal/assets/../doc.html",
	} {
		request(t, got, http.MethodGet, target, http.StatusUnauthorized)
		response := authenticatedRequest(got, http.MethodGet, target, "user", "secret")
		if response.Code != nextStatus || response.Body.String() != target {
			t.Errorf("authorized alias %q did not reach the host unchanged: status = %d, URI = %q", target, response.Code, response.Body.String())
		}
		if cacheControl := response.Result().Header.Get("Cache-Control"); cacheControl != "private, no-store" {
			t.Errorf("authorized alias %q Cache-Control = %q, want private, no-store", target, cacheControl)
		}
	}
}

func TestBasicAuthProtectsRelativeSpecOutsideMount(t *testing.T) {
	t.Parallel()
	got, err := NewHandler(Config{
		BasePath:  "/docs/internal",
		SpecURL:   "../../openapi.json?version=1#section",
		BasicAuth: &BasicAuthConfig{Username: "user", Password: "secret"},
	}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(nextStatus) }))
	if err != nil {
		t.Fatal(err)
	}
	request(t, got, http.MethodGet, "/openapi.json?version=2", http.StatusUnauthorized)
	request(t, got, http.MethodGet, "/api/ping", nextStatus)
}

func TestBasicAuthPreservesCredentialWhitespaceAndUsesDefaultRealm(t *testing.T) {
	t.Parallel()
	got, err := NewHandler(Config{SpecURL: "/openapi.json", BasicAuth: &BasicAuthConfig{Username: " reader ", Password: " secret "}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := request(t, got, http.MethodGet, "/doc.html", http.StatusUnauthorized)
	if response.Header().Get("WWW-Authenticate") != `Basic realm="Knife4x", charset="UTF-8"` {
		t.Fatal("unexpected default realm")
	}
	if response := authenticatedRequest(got, http.MethodGet, "/doc.html", " reader ", " secret "); response.Code != http.StatusOK {
		t.Fatalf("verbatim credentials returned %d", response.Code)
	}
	if response := authenticatedRequest(got, http.MethodGet, "/doc.html", "reader", "secret"); response.Code != http.StatusUnauthorized {
		t.Fatalf("trimmed credentials returned %d", response.Code)
	}
}

func TestBasicAuthRootSpecDoesNotProtectBusinessRoutes(t *testing.T) {
	t.Parallel()
	got, err := NewHandler(Config{SpecURL: "/", BasicAuth: &BasicAuthConfig{Username: "user", Password: "secret"}},
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(nextStatus) }))
	if err != nil {
		t.Fatal(err)
	}
	request(t, got, http.MethodGet, "/", http.StatusUnauthorized)
	request(t, got, http.MethodGet, "/api/ping", nextStatus)
}

func TestBasicAuthPreventsSharedCachingIncludingHostSpecResponses(t *testing.T) {
	t.Parallel()
	for _, commit := range []string{"header", "body", "flush", "legacy flush", "empty"} {
		t.Run(commit, func(t *testing.T) {
			got, err := NewHandler(Config{SpecURL: "/openapi.json", BasicAuth: &BasicAuthConfig{Username: "user", Password: "secret"}},
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Cache-Control", "public, max-age=3600")
					switch commit {
					case "header":
						w.WriteHeader(http.StatusOK)
					case "body":
						_, _ = w.Write([]byte("{}"))
					case "flush":
						if err := http.NewResponseController(w).Flush(); err != nil {
							t.Errorf("flush: %v", err)
						}
					case "legacy flush":
						w.(http.Flusher).Flush()
					}
				}))
			if err != nil {
				t.Fatal(err)
			}
			for _, target := range []string{"/doc.html", "/assets/index.js", "/openapi.json"} {
				response := authenticatedRequest(got, http.MethodGet, target, "user", "secret")
				if response.Code != http.StatusOK || response.Result().Header.Get("Cache-Control") != "private, no-store" {
					t.Fatalf("%s: status=%d cache=%q", target, response.Code, response.Result().Header.Get("Cache-Control"))
				}
			}
			response := request(t, got, http.MethodGet, "/api/ping", http.StatusOK)
			if response.Result().Header.Get("Cache-Control") != "public, max-age=3600" {
				t.Fatal("unprotected host response caching was changed")
			}
		})
	}
}

func TestBasicAuthMatchesBrowserEncodedDotResolution(t *testing.T) {
	t.Parallel()
	// Expected request paths use WHATWG URL encoded-dot processing before parent
	// traversal, as browsers do for new URL(spec, "https://host/docs/").
	for _, test := range []struct{ spec, target string }{
		{"one/%2e%2e/../openapi.json", "/openapi.json"},
		{"one/.%2E/../openapi.json", "/openapi.json"},
		{"one/%2E./../openapi.json", "/openapi.json"},
		{"one/%2e/../../openapi.json", "/openapi.json"},
		{"one/%2e%2e/openapi.json", "/docs/openapi.json"},
		{"/one/%2e%2e/../openapi.json?version=2#schema", "/openapi.json"},
	} {
		for _, named := range []bool{false, true} {
			cfg := Config{BasePath: "/docs", SpecURL: test.spec, BasicAuth: &BasicAuthConfig{Username: "user", Password: "secret"}}
			if named {
				cfg.SpecURL = ""
				cfg.Specs = []Spec{{Name: "one", URL: test.spec}}
			}
			got, err := NewHandler(cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(nextStatus) }))
			if err != nil {
				t.Fatal(err)
			}
			for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost} {
				response := httptest.NewRecorder()
				got.ServeHTTP(response, httptest.NewRequest(method, test.target, nil))
				if response.Code != http.StatusUnauthorized {
					t.Errorf("%s named=%v %s %s returned %d, want 401", test.spec, named, method, test.target, response.Code)
				}
			}
			response := authenticatedRequest(got, http.MethodGet, test.target, "user", "secret")
			if response.Code != nextStatus {
				t.Errorf("authenticated request returned %d, want %d", response.Code, nextStatus)
			}
		}
	}
}

func TestSpecURLRejectsBackslashesAndCredentialsConsistently(t *testing.T) {
	t.Parallel()
	for _, value := range []string{
		`\openapi.json`,
		`one\..\..\openapi.json`,
		`/\remote.example.test/spec.json`,
		`https://user:pass@api.example.test/openapi.json`,
	} {
		if _, err := NewHandler(Config{BasePath: "/docs", SpecURL: value}, nil); err == nil {
			t.Fatalf("SpecURL %q accepted without BasicAuth", value)
		}
		if _, err := NewHandler(Config{
			BasePath:  "/docs",
			SpecURL:   value,
			BasicAuth: &BasicAuthConfig{Username: "user", Password: "secret"},
		}, nil); err == nil {
			t.Fatalf("SpecURL %q accepted with BasicAuth", value)
		}
		if _, err := NewHandler(Config{BasePath: "/docs", Specs: []Spec{{Name: "v1", URL: value}}}, nil); err == nil {
			t.Fatalf("Specs[0].URL %q accepted", value)
		}
	}
}

func authenticatedRequest(handler http.Handler, method, target, username, password string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, nil)
	request.SetBasicAuth(username, password)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
