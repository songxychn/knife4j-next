package main

import (
	"embed"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

//go:embed testdata/springdoc-oas31.json
var openAPISpec []byte

//go:embed docs/*.md
var documentation embed.FS

const pingSpec = `{"openapi":"3.0.3","info":{"title":"Ping API","version":"1"},"servers":[{"url":"/"}],"paths":{"/api/ping":{"get":{"responses":{"200":{"description":"pong"}}}}}}`

type exampleOptions struct {
	BasePath      string
	DocsEnabled   bool
	MultiSpec     bool
	BasicUser     string
	BasicPassword string
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	basePath := flag.String("base-path", "", "optional documentation mount prefix")
	docsEnabled := flag.Bool("docs-enabled", true, "serve documentation UI and OpenAPI fixtures")
	multiSpec := flag.Bool("multi-spec", false, "show separate Matrix and Ping documentation groups")
	flag.Parse()

	handler, err := newConfiguredHandler(exampleOptions{
		BasePath:      *basePath,
		DocsEnabled:   *docsEnabled,
		MultiSpec:     *multiSpec,
		BasicUser:     os.Getenv("KNIFE4X_BASIC_USER"),
		BasicPassword: os.Getenv("KNIFE4X_BASIC_PASSWORD"),
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Knife4x Gin example listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, handler))
}

func newHandler(basePath string) (http.Handler, error) {
	return newConfiguredHandler(exampleOptions{BasePath: basePath, DocsEnabled: true})
}

func newConfiguredHandler(options exampleOptions) (http.Handler, error) {
	if (options.BasicUser == "") != (options.BasicPassword == "") {
		return nil, fmt.Errorf("KNIFE4X_BASIC_USER and KNIFE4X_BASIC_PASSWORD must be configured together")
	}
	router := gin.New()
	enabled := true
	cfg := knife4x.Config{
		SpecURL:  "openapi.json",
		BasePath: options.BasePath,
		Disabled: !options.DocsEnabled,
		UISettings: &knife4x.UISettings{
			Language:      "zh-CN",
			EnableVersion: &enabled,
		},
		Documents: []knife4x.MarkdownDocument{
			{Title: "接入说明", FS: documentation, Path: "docs/welcome.md"},
		},
	}
	if options.MultiSpec {
		cfg.SpecURL = ""
		cfg.Specs = []knife4x.Spec{
			{Name: "Matrix", URL: "openapi.json"},
			{Name: "Ping", URL: "ping-openapi.json"},
		}
	}
	if options.BasicUser != "" {
		cfg.BasicAuth = &knife4x.BasicAuthConfig{
			Username: options.BasicUser,
			Password: options.BasicPassword,
		}
	}
	handler, err := knife4x.NewHandler(cfg, router)
	if err != nil {
		return nil, err
	}

	// One switch controls both the outer UI and the host-owned spec routes.
	if options.DocsEnabled {
		prefix := strings.TrimRight(options.BasePath, "/")
		router.GET(prefix+"/openapi.json", func(c *gin.Context) {
			c.Data(http.StatusOK, "application/json; charset=utf-8", openAPISpec)
		})
		if options.MultiSpec {
			router.GET(prefix+"/ping-openapi.json", func(c *gin.Context) {
				c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(pingSpec))
			})
		}
	}
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
