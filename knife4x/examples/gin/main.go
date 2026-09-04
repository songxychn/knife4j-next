package main

import (
	_ "embed"
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

//go:embed testdata/springdoc-oas31.json
var openAPISpec []byte

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
		c.Data(http.StatusOK, "application/json; charset=utf-8", openAPISpec)
	})
	matrixResponse := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"id": 1, "serverValue": "server"})
	}
	router.GET("/oas31/search", matrixResponse)
	router.POST("/oas31/json", matrixResponse)
	router.POST("/oas31/raw-binary", matrixResponse)
	router.POST("/oas31/multipart", matrixResponse)
	router.GET("/api/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "pong"})
	})
	return handler, nil
}
