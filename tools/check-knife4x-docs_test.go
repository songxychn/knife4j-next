package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAPITableDetectsRealContractDrift(t *testing.T) {
	api := publicAPI{
		"Config": {{"SpecURL", "string", ""}, {"Specs", "[]Spec", ""}},
		"Spec":   {{"Name", "string", ""}, {"URL", "string", ""}},
	}
	meta := versionMetadata{Version: "v0.9.2", UnreleasedConfigFields: []string{"Specs"}}
	const valid = `<!-- knife4x-api: Config -->
| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| ` + "`SpecURL` | `string` | `v0.9.2` | 单个 URL |\n" +
		"| `Specs` | `[]Spec` | `未发布` | 多个 URL |\n" + `<!-- /knife4x-api -->
<!-- knife4x-api: Spec -->
| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| ` + "`Name` | `string` | `未发布` | 名称 |\n" +
		"| `URL` | `string` | `未发布` | 地址 |\n" + `<!-- /knife4x-api -->`
	if err := checkAPITables(api, meta, valid); err != nil {
		t.Fatal(err)
	}
	for name, markdown := range map[string]string{
		"missing field":       strings.ReplaceAll(valid, "| `Specs` | `[]Spec` | `未发布` | 多个 URL |", ""),
		"wrong type":          strings.ReplaceAll(valid, "`[]Spec`", "`*Spec`"),
		"false release claim": strings.ReplaceAll(valid, "`未发布`", "`v0.9.2`"),
		"duplicate table":     valid + valid,
		"unknown field":       strings.ReplaceAll(valid, "`SpecURL`", "`NotAField`"),
		"empty docs":          "",
	} {
		t.Run(name, func(t *testing.T) {
			if err := checkAPITables(api, meta, markdown); err == nil {
				t.Fatal("contract drift was accepted")
			}
		})
	}
	// A newly added source field must fail even if the old Markdown is untouched.
	api["Config"] = append(api["Config"], apiField{"Other", "bool", ""})
	if err := checkAPITables(api, meta, valid); err == nil {
		t.Fatal("undocumented source field was accepted")
	}
}

func TestGoASTHandlesCommentsGroupedFieldsAndTags(t *testing.T) {
	dir := t.TempDir()
	text := "package knife4x\n type Config struct {\n // hint\n SpecURL, BasePath string `json:\"url\"`\n Specs []Spec\n hidden int\n }\ntype Spec struct { Name string; URL string }\n"
	if err := os.WriteFile(filepath.Join(dir, "handler.go"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	api, err := readPublicAPI(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(api["Config"]) != 3 || api["Config"][1] != (apiField{"BasePath", "string", "url"}) || api["Config"][2].typ != "[]Spec" {
		t.Fatalf("unexpected public AST: %#v", api)
	}
	if _, err := availability(api, versionMetadata{UnreleasedConfigFields: []string{"NoSuchField"}}); err == nil {
		t.Fatal("unknown unreleased field was accepted")
	}
}

func TestVersionAndLinkChecksFailOnStaleDocumentation(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs/knife4x"), 0700); err != nil {
		t.Fatal(err)
	}
	write := func(text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, "docs/knife4x/index.md"), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	const module = "example.com/knife4x"
	meta := versionMetadata{Version: "v0.9.2"}
	const marker = "<!-- knife4x-version -->v0.9.2<!-- /knife4x-version -->"
	write(marker + "\ngo get " + module + "@v0.9.2\n")
	if err := checkMarkdown(root, "docs/knife4x/index.md", module, meta); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{
		strings.ReplaceAll(marker, "v0.9.2", "v0.9.1"),
		marker + "\ngo get " + module + "@v0.9.1\n",
		marker + "\n[missing](./missing.md)",
		marker + "\n```go\npackage main\n```\n",
		marker + marker,
	} {
		write(text)
		if err := checkMarkdown(root, "docs/knife4x/index.md", module, meta); err == nil {
			t.Fatalf("invalid documentation was accepted: %s", text)
		}
	}
}

func TestUIDefaultsUseJSONNamesAndDetectChangedDefaults(t *testing.T) {
	fields := []apiField{{"EnableModels", "*bool", "enableSwaggerModels"}, {"Language", "string", "language"}}
	const markdown = "| `EnableModels` | `*bool` | `未发布` | UI 默认 `true` |"
	if err := verifyUIDefaults(fields, map[string]string{"enableSwaggerModels": "true"}, markdown); err != nil {
		t.Fatal(err)
	}
	if err := verifyUIDefaults(fields, map[string]string{"enableSwaggerModels": "false"}, markdown); err == nil {
		t.Fatal("shared UI default changed without updating its documentation")
	}
	if err := verifyUIDefaults(fields, map[string]string{}, markdown); err == nil {
		t.Fatal("unknown JSON/default mapping accepted")
	}
}

func TestReleaseMetadataRejectsInvalidOrTrailingData(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "knife4x/go")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{
		`{"version":"latest","exampleCompatibilityVersion":"v0.9.2"}`,
		`{"version":"v0.9.2","exampleCompatibilityVersion":"v0.9.2"}{}`,
		`{"version":"v0.9.2","exampleCompatibilityVersion":"v0.9.2","typo":true}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, "docs-version.json"), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readMetadata(root); err == nil {
			t.Fatalf("invalid metadata accepted: %s", text)
		}
	}
}

func TestRenderedLinksUseActualHTMLAnchors(t *testing.T) {
	site := t.TempDir()
	if err := os.MkdirAll(filepath.Join(site, "knife4x"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(site, "knife4x/next.html"), []byte(`<h2 id="完整关闭">content</h2>`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := checkRenderedLinks(site, "knife4x/index.html", `<a href="/knife4x/next#完整关闭">link</a>`); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{`<a href="/knife4x/next#missing">link</a>`, `<a href="/knife4x/missing">link</a>`} {
		if err := checkRenderedLinks(site, "knife4x/index.html", text); err == nil {
			t.Fatalf("broken rendered link accepted: %s", text)
		}
	}
}
