package main

import (
	"log"
	"net/http"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

func main() {
	app := http.NewServeMux()
	app.HandleFunc("/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openapi":"3.0.3","info":{"title":"Example API","version":"1"},"paths":{"/api/ping":{"get":{"responses":{"200":{"description":"pong"}}}}}}`))
	})
	app.HandleFunc("/api/ping", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"pong"}`))
	})

	handler, err := knife4x.NewHandler(knife4x.Config{
		SpecURL: "/openapi.json",
	}, app)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":8080", handler))
}
