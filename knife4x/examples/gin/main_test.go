package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestGinExample(t *testing.T) {
	tests := []struct {
		name       string
		basePath   string
		docPath    string
		specPath   string
		wantConfig string
	}{
		{
			name:       "root",
			docPath:    "/doc.html",
			specPath:   "/openapi.json",
			wantConfig: `{"specUrl":"openapi.json","basePath":"/"`,
		},
		{
			name:       "subpath",
			basePath:   "/internal/",
			docPath:    "/internal/doc.html",
			specPath:   "/internal/openapi.json",
			wantConfig: `{"specUrl":"openapi.json","basePath":"/internal"`,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			handler, err := newHandler(test.basePath)
			if err != nil {
				t.Fatalf("newHandler() error = %v", err)
			}

			doc := request(t, handler, test.docPath, http.StatusOK)
			if !strings.Contains(string(doc), test.wantConfig) {
				t.Fatalf("%s does not contain config %s", test.docPath, test.wantConfig)
			}
			request(t, handler, resolveAsset(t, test.docPath, string(doc), `src="./`), http.StatusOK)
			request(t, handler, resolveAsset(t, test.docPath, string(doc), `href="./`), http.StatusOK)

			spec := request(t, handler, test.specPath, http.StatusOK)
			var document struct {
				OpenAPI string `json:"openapi"`
				Servers []struct {
					URL string `json:"url"`
				} `json:"servers"`
				Paths map[string]json.RawMessage `json:"paths"`
			}
			if err := json.Unmarshal(spec, &document); err != nil {
				t.Fatalf("decode OpenAPI fixture: %v", err)
			}
			if document.OpenAPI != "3.1.0" {
				t.Fatalf("OpenAPI version = %q, want 3.1.0", document.OpenAPI)
			}
			if len(document.Servers) != 1 || document.Servers[0].URL != "/" {
				t.Fatalf("OpenAPI servers = %#v, want root server", document.Servers)
			}
			if _, ok := document.Paths["/oas31/multipart"]; !ok {
				t.Fatal("OpenAPI fixture does not describe the Springdoc multipart matrix")
			}

			var matrixResponse struct {
				ID          int    `json:"id"`
				ServerValue string `json:"serverValue"`
			}
			if err := json.Unmarshal(requestWithMethod(
				t,
				handler,
				http.MethodPost,
				"/oas31/json",
				http.StatusOK,
			), &matrixResponse); err != nil {
				t.Fatalf("decode matrix response: %v", err)
			}
			if matrixResponse.ID != 1 || matrixResponse.ServerValue != "server" {
				t.Fatalf("matrix response = %#v", matrixResponse)
			}

			var ping map[string]string
			if err := json.Unmarshal(request(t, handler, "/api/ping", http.StatusOK), &ping); err != nil {
				t.Fatalf("decode ping response: %v", err)
			}
			if ping["message"] != "pong" {
				t.Fatalf("ping message = %q, want pong", ping["message"])
			}

			for _, legacyPath := range []string{
				"/knife4j/config",
				"/v3/api-docs/swagger-config",
				"/swagger-resources",
			} {
				request(t, handler, legacyPath, http.StatusNotFound)
			}
		})
	}
}

func TestOpenAPIFixtureMatchesCanonicalSpringdocSnapshot(t *testing.T) {
	canonicalPath := filepath.Join(
		"..",
		"..",
		"..",
		"front",
		"ui-react",
		"src",
		"test-fixtures",
		"springdoc-oas31",
		"boot3-mvc-springdoc-2.9.1.json",
	)
	canonical, err := os.ReadFile(canonicalPath)
	if err != nil {
		t.Fatalf("read canonical Springdoc snapshot: %v", err)
	}
	var embeddedDocument any
	if err := json.Unmarshal(openAPISpec, &embeddedDocument); err != nil {
		t.Fatalf("decode embedded Springdoc snapshot: %v", err)
	}
	var canonicalDocument any
	if err := json.Unmarshal(canonical, &canonicalDocument); err != nil {
		t.Fatalf("decode canonical Springdoc snapshot: %v", err)
	}
	if !reflect.DeepEqual(embeddedDocument, canonicalDocument) {
		t.Fatal("embedded Knife4x fixture differs from the canonical Springdoc snapshot")
	}
}

func TestConfiguredExampleProtectsDocumentsAndPreservesBusinessAPI(t *testing.T) {
	for _, basePath := range []string{"", "/internal"} {
		t.Run(basePath, func(t *testing.T) {
			handler, err := newConfiguredHandler(exampleOptions{
				BasePath: basePath, DocsEnabled: true, MultiSpec: true,
				BasicUser: "docs-user", BasicPassword: "example-test-password",
			})
			if err != nil {
				t.Fatal(err)
			}
			for _, suffix := range []string{"/doc.html", "/openapi.json", "/ping-openapi.json", "/oauth2-redirect.html"} {
				for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost} {
					requestWithMethod(t, handler, method, basePath+suffix, http.StatusUnauthorized)
				}
			}
			request(t, handler, "/api/ping", http.StatusOK)

			doc := authenticatedRequest(t, handler, basePath+"/doc.html", http.StatusOK)
			if strings.Contains(doc, "example-test-password") || strings.Contains(doc, "docs-user") {
				t.Fatal("documentation page contains Basic Auth credentials")
			}
			config := injectedConfig(t, doc)
			var settings struct {
				Language      string `json:"language"`
				EnableVersion bool   `json:"enableVersion"`
			}
			if err := json.Unmarshal(config["settings"], &settings); err != nil || settings.Language != "zh-CN" || !settings.EnableVersion {
				t.Fatalf("unexpected UI defaults: %#v (decode error: %v)", settings, err)
			}
			var specs []struct {
				Name string `json:"name"`
				URL  string `json:"url"`
			}
			if err := json.Unmarshal(config["specs"], &specs); err != nil {
				t.Fatal(err)
			}
			if len(specs) != 2 || specs[0].Name != "Matrix" || specs[1].Name != "Ping" || specs[1].URL != "ping-openapi.json" {
				t.Fatalf("unexpected configured groups: %#v", specs)
			}
			var documents []struct {
				Title   string `json:"title"`
				Content string `json:"content"`
			}
			if err := json.Unmarshal(config["documents"], &documents); err != nil {
				t.Fatal(err)
			}
			if len(documents) != 1 || documents[0].Title != "接入说明" || !strings.Contains(documents[0].Content, "业务 API") {
				t.Fatalf("embedded Markdown was not loaded: %#v", documents)
			}
			authenticatedRequest(t, handler, resolveAsset(t, basePath+"/doc.html", doc, `src="./`), http.StatusOK)
			for _, suffix := range []string{"/openapi.json", "/ping-openapi.json"} {
				body := authenticatedRequest(t, handler, basePath+suffix, http.StatusOK)
				var spec struct {
					OpenAPI string `json:"openapi"`
				}
				if err := json.Unmarshal([]byte(body), &spec); err != nil || !strings.HasPrefix(spec.OpenAPI, "3.") {
					t.Fatalf("invalid example spec at %s", suffix)
				}
			}
		})
	}
}

func TestConfiguredExampleDisablesUIAndHostSpecRoutesTogether(t *testing.T) {
	for _, basePath := range []string{"", "/internal"} {
		handler, err := newConfiguredHandler(exampleOptions{
			BasePath: basePath, DocsEnabled: false, MultiSpec: true,
			BasicUser: "docs-user", BasicPassword: "example-test-password",
		})
		if err != nil {
			t.Fatal(err)
		}
		enabled, err := newHandler(basePath)
		if err != nil {
			t.Fatal(err)
		}
		docPath := basePath + "/doc.html"
		doc := request(t, enabled, docPath, http.StatusOK)
		asset := resolveAsset(t, docPath, string(doc), `src="./`)
		for _, path := range []string{docPath, basePath + "/openapi.json", basePath + "/ping-openapi.json", basePath + "/oauth2-redirect.html", asset} {
			request(t, handler, path, http.StatusNotFound)
		}
		request(t, handler, "/api/ping", http.StatusOK)
	}
}

func TestConfiguredExampleRejectsIncompleteCredentials(t *testing.T) {
	for _, options := range []exampleOptions{
		{DocsEnabled: true, BasicUser: "docs-user"},
		{DocsEnabled: true, BasicPassword: "example-test-password"},
	} {
		if _, err := newConfiguredHandler(options); err == nil {
			t.Fatal("incomplete Basic Auth credentials should fail startup")
		}
	}
}

func authenticatedRequest(t *testing.T, handler http.Handler, target string, wantStatus int) string {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.SetBasicAuth("docs-user", "example-test-password")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	if recorder.Code != wantStatus {
		t.Fatalf("authenticated GET %s status = %d, want %d", target, recorder.Code, wantStatus)
	}
	return recorder.Body.String()
}

func injectedConfig(t *testing.T, body string) map[string]json.RawMessage {
	t.Helper()
	const marker = "window.__KNIFE4X_CONFIG__="
	start := strings.Index(body, marker)
	if start < 0 {
		t.Fatal("missing browser config")
	}
	start += len(marker)
	end := strings.Index(body[start:], ";</script>")
	if end < 0 {
		t.Fatal("unterminated browser config")
	}
	var config map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body[start:start+end]), &config); err != nil {
		t.Fatal(err)
	}
	return config
}

func request(t *testing.T, handler http.Handler, target string, wantStatus int) []byte {
	t.Helper()
	return requestWithMethod(t, handler, http.MethodGet, target, wantStatus)
}

func requestWithMethod(t *testing.T, handler http.Handler, method, target string, wantStatus int) []byte {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	if recorder.Code != wantStatus {
		t.Fatalf("%s %s status = %d, want %d", method, target, recorder.Code, wantStatus)
	}
	return recorder.Body.Bytes()
}

func resolveAsset(t *testing.T, documentPath, body, marker string) string {
	t.Helper()

	start := strings.Index(body, marker)
	if start < 0 {
		t.Fatalf("document does not contain asset marker %q", marker)
	}
	start += len(marker) - len("./")
	end := strings.IndexByte(body[start:], '"')
	if end < 0 {
		t.Fatal("relative script asset is not terminated")
	}

	base, err := url.Parse("http://example.test" + documentPath)
	if err != nil {
		t.Fatalf("parse document URL: %v", err)
	}
	reference, err := url.Parse(body[start : start+end])
	if err != nil {
		t.Fatalf("parse asset reference: %v", err)
	}
	return base.ResolveReference(reference).Path
}
