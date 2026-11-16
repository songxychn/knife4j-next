package main

import (
	"encoding/json"
	"log"
	"net/http"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

func main() {
	app := http.NewServeMux()
	app.HandleFunc("/internal/users.json", serveSpec("User API"))
	app.HandleFunc("/spec/orders.json", serveSpec("Order API"))

	handler, err := knife4x.NewHandler(knife4x.Config{
		BasePath: "/internal",
		Specs: []knife4x.Spec{
			{Name: "用户中心", URL: "users.json"},
			{Name: "订单中心", URL: "/spec/orders.json"},
		},
	}, app)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":8080", handler))
}

func serveSpec(title string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"openapi": "3.0.3",
			"info":    map[string]string{"title": title, "version": "1"},
			"paths":   map[string]any{},
		})
	}
}
