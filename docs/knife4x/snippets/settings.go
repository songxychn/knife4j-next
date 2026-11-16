package main

import (
	"embed"
	"log"
	"net/http"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

//go:embed guide.txt
var documentation embed.FS

func boolValue(value bool) *bool { return &value }

func main() {
	app := http.NewServeMux()
	app.HandleFunc("/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openapi":"3.0.3","info":{"title":"Example API","version":"1"},"paths":{}}`))
	})

	handler, err := knife4x.NewHandler(knife4x.Config{
		SpecURL: "/openapi.json",
		UISettings: &knife4x.UISettings{
			Language:             "zh-CN",
			EnableDebug:          boolValue(false),
			EnableSearch:         boolValue(true),
			EnableOpenAPI:        boolValue(true),
			EnableRequestCache:   boolValue(true),
			EnableVersion:        boolValue(true),
			EnableModels:         boolValue(true),
			EnableDocumentManage: boolValue(true),
			EnableGroup:          boolValue(true),
			EnableFooter:         boolValue(false),
			EnableCustomFooter:   boolValue(true),
			EnableCustomHome:     boolValue(true),
			HomeMarkdown:         "# 内部接口文档\n请先阅读接入说明。",
			FooterMarkdown:       "内部使用",
		},
		Documents: []knife4x.MarkdownDocument{
			{Title: "接入说明", FS: documentation, Path: "guide.txt"},
			{Title: "错误码", Content: "# 错误码\n业务错误码见各接口说明。"},
		},
	}, app)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":8080", handler))
}
