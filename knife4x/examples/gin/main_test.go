package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
			wantConfig: `{"specUrl":"openapi.json","basePath":"/"}`,
		},
		{
			name:       "subpath",
			basePath:   "/internal/",
			docPath:    "/internal/doc.html",
			specPath:   "/internal/openapi.json",
			wantConfig: `{"specUrl":"openapi.json","basePath":"/internal"}`,
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
				Servers []struct {
					URL string `json:"url"`
				} `json:"servers"`
				Paths map[string]json.RawMessage `json:"paths"`
			}
			if err := json.Unmarshal(spec, &document); err != nil {
				t.Fatalf("decode OpenAPI fixture: %v", err)
			}
			if len(document.Servers) != 1 || document.Servers[0].URL != "/" {
				t.Fatalf("OpenAPI servers = %#v, want root server", document.Servers)
			}
			if _, ok := document.Paths["/api/ping"]; !ok {
				t.Fatal("OpenAPI fixture does not describe /api/ping")
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

func request(t *testing.T, handler http.Handler, target string, wantStatus int) []byte {
	t.Helper()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	if recorder.Code != wantStatus {
		t.Fatalf("GET %s status = %d, want %d", target, recorder.Code, wantStatus)
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
