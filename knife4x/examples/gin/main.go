package main

import (
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

const openAPISpec = `{
  "openapi": "3.0.3",
  "info": {
    "title": "Knife4x Gin Example",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "/"
    }
  ],
  "paths": {
    "/api/ping": {
      "get": {
        "summary": "Ping",
        "operationId": "ping",
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "message": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	basePath := flag.String("base-path", "", "optional documentation mount prefix")
	flag.Parse()

	handler, err := newHandler(*basePath)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Knife4x Gin example listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, handler))
}

func newHandler(basePath string) (http.Handler, error) {
	router := gin.New()
	handler, err := knife4x.NewHandler(knife4x.Config{
		SpecURL:  "openapi.json",
		BasePath: basePath,
	}, router)
	if err != nil {
		return nil, err
	}

	prefix := strings.TrimRight(basePath, "/")
	router.GET(prefix+"/openapi.json", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(openAPISpec))
	})
	router.GET("/api/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "pong"})
	})
	return handler, nil
}
