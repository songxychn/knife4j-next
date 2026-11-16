package main

import (
	"log"
	"net/http"
	"os"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

func main() {
	docsEnabled := os.Getenv("DOCS_ENABLED") == "true"
	app := http.NewServeMux()
	app.HandleFunc("/api/ping", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"pong"}`))
	})
	if docsEnabled {
		app.HandleFunc("/internal/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"openapi":"3.0.3","info":{"title":"Internal API","version":"1"},"paths":{}}`))
		})
	}

	handler, err := knife4x.NewHandler(knife4x.Config{
		Disabled: !docsEnabled,
		BasePath: "/internal",
		SpecURL:  "openapi.json",
		BasicAuth: &knife4x.BasicAuthConfig{
			Username: os.Getenv("DOCS_USERNAME"),
			Password: os.Getenv("DOCS_PASSWORD"),
		},
	}, app)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":8080", handler))
}
