package knife4x

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const nextStatus = 299

func TestNewHandlerValidatesConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		cfg  Config
	}{
		{name: "empty spec URL", cfg: Config{}},
		{name: "blank spec URL", cfg: Config{SpecURL: " \t "}},
		{name: "protocol-relative spec URL", cfg: Config{SpecURL: "//api.example.test/openapi.json"}},
		{name: "non-HTTP spec URL", cfg: Config{SpecURL: "data:application/json,{}"}},
		{name: "HTTP spec URL without host", cfg: Config{SpecURL: "https:/openapi.json"}},
		{name: "relative base path", cfg: Config{SpecURL: "/openapi.json", BasePath: "internal"}},
		{name: "protocol-relative base path", cfg: Config{SpecURL: "/openapi.json", BasePath: "//internal"}},
		{name: "base path query", cfg: Config{SpecURL: "/openapi.json", BasePath: "/internal?debug=1"}},
		{name: "base path fragment", cfg: Config{SpecURL: "/openapi.json", BasePath: "/internal#docs"}},
		{name: "base path backslash", cfg: Config{SpecURL: "/openapi.json", BasePath: `/internal\docs`}},
		{name: "unclean base path", cfg: Config{SpecURL: "/openapi.json", BasePath: "/internal/../docs"}},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := NewHandler(test.cfg, nil); err == nil {
				t.Fatal("NewHandler() error = nil, want validation error")
			}
		})
	}
}

func TestHandlerServesRootUIAndPassesThroughOtherRequests(t *testing.T) {
	t.Parallel()

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(nextStatus)
	})
	got, err := NewHandler(Config{SpecURL: "/openapi.json"}, next)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	doc := request(t, got, http.MethodGet, "/doc.html", http.StatusOK)
	body := doc.Body.String()
	config := readInjectedConfig(t, body)
	wantConfig := map[string]string{"specUrl": "/openapi.json", "basePath": "/"}
	if !reflect.DeepEqual(config, wantConfig) {
		t.Fatalf("injected config = %#v, want %#v", config, wantConfig)
	}
	if strings.Index(body, configAssignment) > strings.Index(body, moduleScriptMark) {
		t.Fatal("browser config was injected after the module script")
	}

	reference := firstAssetReference(t, body)
	request(t, got, http.MethodGet, "/"+reference, http.StatusOK)
	request(t, got, http.MethodHead, "/doc.html", http.StatusOK)

	for _, target := range []string{
		"/",
		"/api/ping",
		"/openapi.json",
		"/assets/missing.js",
		"/index.html",
	} {
		request(t, got, http.MethodGet, target, nextStatus)
	}
	request(t, got, http.MethodPost, "/doc.html", nextStatus)
}

func TestHandlerServesSubpathAssets(t *testing.T) {
	t.Parallel()

	got, err := NewHandler(Config{
		SpecURL:  "openapi.json",
		BasePath: "/internal/",
	}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(nextStatus)
	}))
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	doc := request(t, got, http.MethodGet, "/internal/doc.html", http.StatusOK)
	config := readInjectedConfig(t, doc.Body.String())
	wantConfig := map[string]string{"specUrl": "openapi.json", "basePath": "/internal"}
	if !reflect.DeepEqual(config, wantConfig) {
		t.Fatalf("injected config = %#v, want %#v", config, wantConfig)
	}

	for _, target := range []string{
		"/internal/assets/index.js",
		"/internal/assets/index.css",
		"/internal/knife4j-next-mark.svg",
		"/internal/oauth2-redirect.html",
	} {
		request(t, got, http.MethodGet, target, http.StatusOK)
	}

	for _, target := range []string{
		"/internal",
		"/internal/",
		"/internal/business",
		"/doc.html",
		"/internal/index.html",
		"/internal/assets/missing.js",
	} {
		request(t, got, http.MethodGet, target, nextStatus)
	}
}

func TestHandlerEscapesInjectedConfig(t *testing.T) {
	t.Parallel()

	specURL := `/openapi.json?value=</script><script>alert("x")</script>`
	got, err := NewHandler(Config{SpecURL: specURL}, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	doc := request(t, got, http.MethodGet, "/doc.html", http.StatusOK)
	body := doc.Body.String()
	if strings.Contains(body, `</script><script>alert("x")</script>`) {
		t.Fatal("injected config contains an unescaped script terminator")
	}
	config := readInjectedConfig(t, body)
	if config["specUrl"] != specURL {
		t.Fatalf("injected specUrl = %q, want %q", config["specUrl"], specURL)
	}
	if len(config) != 2 {
		t.Fatalf("injected config has %d fields, want 2", len(config))
	}
}

func TestHandlerUsesNotFoundWhenNextIsNil(t *testing.T) {
	t.Parallel()

	got, err := NewHandler(Config{SpecURL: "https://api.example.test/openapi.json"}, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request(t, got, http.MethodGet, "/api/ping", http.StatusNotFound)
}

func request(t *testing.T, handler http.Handler, method, target string, wantStatus int) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	if recorder.Code != wantStatus {
		t.Fatalf("%s %s status = %d, want %d", method, target, recorder.Code, wantStatus)
	}
	return recorder
}

func readInjectedConfig(t *testing.T, body string) map[string]string {
	t.Helper()

	start := strings.Index(body, configAssignment)
	if start < 0 {
		t.Fatal("document does not contain Knife4x config")
	}
	start += len(configAssignment)
	end := strings.Index(body[start:], ";</script>")
	if end < 0 {
		t.Fatal("Knife4x config script is not terminated")
	}

	var config map[string]string
	if err := json.Unmarshal([]byte(body[start:start+end]), &config); err != nil {
		t.Fatalf("decode injected config: %v", err)
	}
	return config
}

func firstAssetReference(t *testing.T, body string) string {
	t.Helper()

	const marker = `src="./`
	start := strings.Index(body, marker)
	if start < 0 {
		t.Fatal("document does not contain a relative script asset")
	}
	start += len(marker)
	end := strings.IndexByte(body[start:], '"')
	if end < 0 {
		t.Fatal("relative script asset is not terminated")
	}
	return body[start : start+end]
}
