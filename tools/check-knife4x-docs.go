// Command check-knife4x-docs checks the Go documentation against public Go ASTs
// and compiles the examples actually included by the site. It is not a prose
// verifier or evidence that a website deployment has completed.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"html"
	"io"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type versionMetadata struct {
	Version                     string   `json:"version"`
	ExampleCompatibilityVersion string   `json:"exampleCompatibilityVersion"`
	UnreleasedConfigFields      []string `json:"unreleasedConfigFields"`
}

type apiField struct{ name, typ, jsonKey string }
type publicAPI map[string][]apiField

var apiBlock = regexp.MustCompile(`(?s)<!-- knife4x-api: (\w+) -->(.*?)<!-- /knife4x-api -->`)
var versionMarker = regexp.MustCompile(`<!-- knife4x-version -->(.*?)<!-- /knife4x-version -->`)
var markdownLink = regexp.MustCompile(`\[[^\]\n]*\]\(([^\s)]+)\)`)

func main() {
	root := flag.String("root", ".", "repository root")
	site := flag.String("site", "", "verify built site provenance and Go pages only")
	flag.Parse()
	absRoot, err := filepath.Abs(*root)
	if err == nil {
		if *site == "" {
			err = checkDocs(absRoot)
		} else {
			err = checkBuiltSite(absRoot, *site)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Knife4x docs:", err)
		os.Exit(1)
	}
	fmt.Println("Knife4x documentation checks passed")
}

func readMetadata(root string) (versionMetadata, error) {
	var meta versionMetadata
	data, err := os.ReadFile(filepath.Join(root, "knife4x/go/docs-version.json"))
	if err != nil {
		return meta, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&meta); err != nil {
		return meta, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return meta, fmt.Errorf("unexpected trailing release metadata")
	}
	validVersion := regexp.MustCompile(`^v\d+\.\d+\.\d+$`)
	if !validVersion.MatchString(meta.Version) || !validVersion.MatchString(meta.ExampleCompatibilityVersion) {
		return meta, fmt.Errorf("invalid documented release %q", meta.Version)
	}
	return meta, nil
}

func readPublicAPI(dir string) (publicAPI, error) {
	fset := token.NewFileSet()
	packages, err := parser.ParseDir(fset, dir, func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		return nil, err
	}
	pkg := packages["knife4x"]
	if pkg == nil {
		return nil, fmt.Errorf("no knife4x package in %s", dir)
	}
	api := publicAPI{}
	for _, file := range pkg.Files {
		for _, decl := range file.Decls {
			general, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range general.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok || !ast.IsExported(typeSpec.Name.Name) {
					continue
				}
				structure, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					continue
				}
				fields := []apiField{}
				for _, field := range structure.Fields.List {
					if len(field.Names) == 0 {
						return nil, fmt.Errorf("public struct %s has embedded fields; extend the documentation contract explicitly", typeSpec.Name.Name)
					}
					var typ bytes.Buffer
					if err := format.Node(&typ, fset, field.Type); err != nil {
						return nil, err
					}
					jsonKey := ""
					if field.Tag != nil {
						tag, err := strconv.Unquote(field.Tag.Value)
						if err != nil {
							return nil, err
						}
						jsonKey = strings.Split(reflect.StructTag(tag).Get("json"), ",")[0]
					}
					for _, name := range field.Names {
						if ast.IsExported(name.Name) {
							fields = append(fields, apiField{name.Name, typ.String(), jsonKey})
						}
					}
				}
				api[typeSpec.Name.Name] = fields
			}
		}
	}
	return api, nil
}

func availability(api publicAPI, meta versionMetadata) (map[string]bool, error) {
	unreleased := map[string]bool{}
	fields := map[string]string{}
	for _, field := range api["Config"] {
		fields[field.name] = field.typ
	}
	for _, name := range meta.UnreleasedConfigFields {
		if _, exists := fields[name]; !exists || unreleased[name] {
			return nil, fmt.Errorf("unreleased Config field %q is unknown or duplicated", name)
		}
		unreleased[name] = true
	}
	newTypes := map[string]bool{}
	var visit func(string)
	visit = func(typ string) {
		typ = strings.TrimLeft(typ, "[]*")
		if _, exists := api[typ]; !exists || newTypes[typ] {
			return
		}
		newTypes[typ] = true
		for _, field := range api[typ] {
			visit(field.typ)
		}
	}
	for name := range unreleased {
		visit(fields[name])
	}
	return newTypes, nil
}

func checkAPITables(api publicAPI, meta versionMetadata, markdown string) error {
	newTypes, err := availability(api, meta)
	if err != nil {
		return err
	}
	unreleased := map[string]bool{}
	for _, name := range meta.UnreleasedConfigFields {
		unreleased[name] = true
	}
	seen := map[string]bool{}
	for _, match := range apiBlock.FindAllStringSubmatch(markdown, -1) {
		name := match[1]
		fields, exists := api[name]
		if !exists || seen[name] {
			return fmt.Errorf("API table %q is unknown or duplicated", name)
		}
		seen[name] = true
		rows := map[string][]string{}
		for _, line := range strings.Split(match[2], "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "|") {
				continue
			}
			cells := strings.Split(strings.Trim(line, "|"), "|")
			for i := range cells {
				cells[i] = strings.TrimSpace(cells[i])
				if i < 3 {
					cells[i] = strings.Trim(cells[i], "`")
				}
			}
			if len(cells) != 4 || cells[0] == "字段" || strings.HasPrefix(cells[0], "---") {
				continue
			}
			if _, exists := rows[cells[0]]; exists {
				return fmt.Errorf("duplicate %s.%s row", name, cells[0])
			}
			rows[cells[0]] = cells
		}
		for _, field := range fields {
			row := rows[field.name]
			wantVersion := meta.Version
			if newTypes[name] || (name == "Config" && unreleased[field.name]) {
				wantVersion = "未发布"
			}
			if len(row) != 4 || row[1] != field.typ || row[2] != wantVersion || row[3] == "" {
				return fmt.Errorf("%s.%s: require type %q, availability %q and a description; got %v", name, field.name, field.typ, wantVersion, row)
			}
			delete(rows, field.name)
		}
		if len(rows) != 0 {
			return fmt.Errorf("%s documents fields absent from Go source: %v", name, rows)
		}
	}
	for name := range api {
		if !seen[name] {
			return fmt.Errorf("missing API table for public struct %s", name)
		}
	}
	return nil
}

func readModule(root string) (string, error) {
	data, err := os.ReadFile(filepath.Join(root, "knife4x/go/go.mod"))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "module" {
			return fields[1], nil
		}
	}
	return "", fmt.Errorf("Go module path missing")
}

func activeMarkdown(root string) ([]string, error) {
	files := []string{"README.md", "knife4x/README.md", "knife4x/go/README.md", "knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md", "knife4x/examples/gin/README.md"}
	err := filepath.WalkDir(filepath.Join(root, "docs/knife4x"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(path, ".md") && entry.Name() != "releases.md" {
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			files = append(files, rel)
		}
		return nil
	})
	return files, err
}

func checkMarkdown(root, name, module string, meta versionMetadata) error {
	data, err := os.ReadFile(filepath.Join(root, name))
	if err != nil {
		return err
	}
	text := string(data)
	for _, match := range versionMarker.FindAllStringSubmatch(text, -1) {
		if strings.TrimSpace(match[1]) != meta.Version {
			return fmt.Errorf("%s documents stale release %q, want %s", name, match[1], meta.Version)
		}
	}
	if (name == "knife4x/go/README.md" || name == "docs/knife4x/index.md") && len(versionMarker.FindAllString(text, -1)) != 1 {
		return fmt.Errorf("%s needs exactly one knife4x-version marker", name)
	}
	install := regexp.MustCompile(`go get\s+` + regexp.QuoteMeta(module) + `@([^\s` + "`" + `]+)`)
	for _, match := range install.FindAllStringSubmatch(text, -1) {
		if match[1] != meta.Version {
			return fmt.Errorf("%s installs %s, want documented release %s", name, match[1], meta.Version)
		}
	}
	tags := regexp.MustCompile(`knife4x/go/(v\d+\.\d+\.\d+)`)
	for _, match := range tags.FindAllStringSubmatch(text, -1) {
		if match[1] != meta.Version {
			return fmt.Errorf("%s links stale current Go tag %s", name, match[1])
		}
	}
	if strings.HasPrefix(name, "docs/knife4x/") && strings.Contains(text, "```go\n") {
		return fmt.Errorf("%s: include a checked .go snippet instead of copying Go fences", name)
	}
	// The site handles its own Markdown links; this also checks links from the
	// package READMEs and redirects, which the site builder never reads.
	for _, match := range markdownLink.FindAllStringSubmatch(text, -1) {
		target, err := url.Parse(match[1])
		if err != nil {
			return fmt.Errorf("%s: invalid link %q", name, match[1])
		}
		if target.IsAbs() || target.Host != "" || target.Path == "" {
			continue
		}
		base := filepath.Dir(filepath.Join(root, name))
		if strings.HasPrefix(target.Path, "/") {
			base = filepath.Join(root, "docs")
		}
		path := filepath.Join(base, strings.TrimPrefix(target.Path, "/"))
		found := false
		for _, candidate := range []string{path, path + ".md", filepath.Join(path, "index.md")} {
			if _, err := os.Stat(candidate); err == nil {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%s: missing local link target %q", name, match[1])
		}
	}
	return nil
}

func checkDocs(root string) error {
	meta, err := readMetadata(root)
	if err != nil {
		return err
	}
	api, err := readPublicAPI(filepath.Join(root, "knife4x/go"))
	if err != nil {
		return err
	}
	config, err := os.ReadFile(filepath.Join(root, "docs/knife4x/configuration.md"))
	if err != nil {
		return err
	}
	if err := checkAPITables(api, meta, string(config)); err != nil {
		return err
	}
	if err := checkUIDefaults(root, api, string(config)); err != nil {
		return err
	}
	module, err := readModule(root)
	if err != nil {
		return err
	}
	files, err := activeMarkdown(root)
	if err != nil {
		return err
	}
	for _, name := range files {
		if err := checkMarkdown(root, filepath.ToSlash(name), module, meta); err != nil {
			return err
		}
	}
	return checkExamples(root, module, meta)
}

func checkUIDefaults(root string, api publicAPI, markdown string) error {
	data, err := os.ReadFile(filepath.Join(root, "front/ui-react/src/types/settings.ts"))
	if err != nil {
		return err
	}
	block := regexp.MustCompile(`(?s)export const DEFAULT_SETTINGS: AppSettings = \{(.*?)\n\};`).FindSubmatch(data)
	if block == nil {
		return fmt.Errorf("cannot find shared UI DEFAULT_SETTINGS")
	}
	defaults := map[string]string{}
	for _, match := range regexp.MustCompile(`(?m)^\s*(\w+): (true|false),?\s*$`).FindAllStringSubmatch(string(block[1]), -1) {
		defaults[match[1]] = match[2]
	}
	return verifyUIDefaults(api["UISettings"], defaults, markdown)
}

func verifyUIDefaults(fields []apiField, defaults map[string]string, markdown string) error {
	for _, field := range fields {
		if field.typ != "*bool" {
			continue
		}
		value, exists := defaults[field.jsonKey]
		if !exists {
			return fmt.Errorf("shared UI default missing for UISettings.%s (%s)", field.name, field.jsonKey)
		}
		row := regexp.MustCompile("(?m)^\\| `" + regexp.QuoteMeta(field.name) + "` \\|.*$").FindString(markdown)
		if !strings.Contains(row, "UI 默认 `"+value+"`") {
			return fmt.Errorf("UISettings.%s must document shared UI default %s", field.name, value)
		}
	}
	return nil
}

func checkExamples(root, module string, meta versionMetadata) error {
	snippets := filepath.Join(root, "docs/knife4x/snippets")
	entries, err := os.ReadDir(snippets)
	if err != nil {
		return err
	}
	basic, err := os.ReadFile(filepath.Join(snippets, "basic.go"))
	if err != nil {
		return err
	}
	readme, err := os.ReadFile(filepath.Join(root, "knife4x/go/README.md"))
	if err != nil {
		return err
	}
	pattern := regexp.MustCompile("(?s)<!-- knife4x-example: basic -->\\s*```go\\n(.*?)\\n```\\s*<!-- /knife4x-example -->")
	blocks := pattern.FindAllSubmatch(readme, -1)
	if len(blocks) != 1 || strings.TrimSpace(string(blocks[0][1])) != strings.TrimSpace(string(basic)) {
		return fmt.Errorf("Go README minimal example must match snippets/basic.go")
	}
	tmp, err := os.MkdirTemp("", "knife4x-docs-consumer-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	for _, entry := range entries {
		if entry.IsDir() {
			return fmt.Errorf("unexpected snippet subdirectory %s", entry.Name())
		}
		data, err := os.ReadFile(filepath.Join(snippets, entry.Name()))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(tmp, entry.Name()), data, 0600); err != nil {
			return err
		}
		if strings.HasSuffix(entry.Name(), ".go") {
			files, err := activeMarkdown(root)
			if err != nil {
				return err
			}
			included := false
			for _, file := range files {
				if !strings.HasPrefix(filepath.ToSlash(file), "docs/knife4x/") {
					continue
				}
				text, err := os.ReadFile(filepath.Join(root, file))
				if err != nil {
					return err
				}
				if strings.Contains(string(text), "<<< ./snippets/"+entry.Name()) {
					included = true
					break
				}
			}
			if !included {
				return fmt.Errorf("Go snippet %s is not included by a guide", entry.Name())
			}
		}
	}
	for _, stable := range []bool{false, true} {
		// The published compatibility baseline stays independent of the next
		// documentation version, so release-preparation PRs need no future tag.
		version := meta.Version
		if stable {
			version = meta.ExampleCompatibilityVersion
		}
		text := "module knife4x-docs-consumer\n\ngo 1.22.0\n\nrequire " + module + " " + version + "\n"
		if !stable {
			text += "\nreplace " + module + " => " + strconv.Quote(filepath.Join(root, "knife4x/go")) + "\n"
		}
		if err := os.WriteFile(filepath.Join(tmp, "go.mod"), []byte(text), 0600); err != nil {
			return err
		}
		if stable {
			if err := runGo(tmp, "mod", "download", module); err != nil {
				return err
			}
		}
		count := 0
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".go") || (stable && entry.Name() != "basic.go") {
				continue
			}
			if output, err := exec.Command("gofmt", "-l", filepath.Join(tmp, entry.Name())).CombinedOutput(); err != nil || len(output) != 0 {
				return fmt.Errorf("snippet %s needs gofmt: %s %v", entry.Name(), output, err)
			}
			if err := runGo(tmp, "build", "-mod=readonly", "-o", filepath.Join(tmp, "example"), entry.Name()); err != nil {
				return fmt.Errorf("snippet %s (published=%t): %w", entry.Name(), stable, err)
			}
			count++
		}
		if count == 0 {
			return fmt.Errorf("no Go documentation examples compiled")
		}
	}
	return nil
}

func runGo(dir string, args ...string) error {
	cmd := exec.Command("go", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOWORK=off")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("go %s: %w\n%s", strings.Join(args, " "), err, output)
	}
	return nil
}

func checkBuiltSite(root, site string) error {
	meta, err := readMetadata(root)
	if err != nil {
		return err
	}
	var built struct {
		SourceRevision string `json:"sourceRevision"`
		Knife4xVersion string `json:"knife4xVersion"`
	}
	data, err := os.ReadFile(filepath.Join(site, "build-info.json"))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &built); err != nil {
		return err
	}
	revision, err := exec.Command("git", "-C", root, "rev-parse", "HEAD").Output()
	if err != nil {
		return err
	}
	if built.SourceRevision != strings.TrimSpace(string(revision)) || built.Knife4xVersion != meta.Version {
		return fmt.Errorf("built provenance does not match HEAD and Go release: %+v", built)
	}
	pages := []string{"index", "configuration", "deployment", "migration", "releases"}
	sort.Strings(pages)
	for _, page := range pages {
		file := filepath.Join(site, "knife4x", page+".html")
		data, err := os.ReadFile(file)
		if err != nil || !bytes.Contains(data, []byte("Knife4x")) {
			return fmt.Errorf("Go site page missing or invalid: %s (%v)", file, err)
		}
		if err := checkRenderedLinks(site, filepath.Join("knife4x", page+".html"), string(data)); err != nil {
			return err
		}
	}
	return nil
}

// Inspect generated double-quoted HTML attributes, avoiding a second Markdown
// slug implementation that could disagree with VitePress's actual anchors.
func checkRenderedLinks(site, page, content string) error {
	for _, match := range regexp.MustCompile(`<a\b[^>]*\bhref="([^"]*)"`).FindAllStringSubmatch(content, -1) {
		target, err := url.Parse(html.UnescapeString(match[1]))
		if err != nil {
			return fmt.Errorf("%s: invalid rendered URL %q", page, match[1])
		}
		if target.IsAbs() || target.Host != "" {
			continue
		}
		rel := page
		if target.Path != "" {
			if strings.HasPrefix(target.Path, "/") {
				rel = strings.TrimPrefix(target.Path, "/")
			} else {
				rel = filepath.Join(filepath.Dir(page), target.Path)
			}
			if strings.HasSuffix(target.Path, "/") {
				rel = filepath.Join(rel, "index.html")
			} else if filepath.Ext(rel) == "" {
				rel += ".html"
			}
		}
		path := filepath.Join(site, rel)
		clean := filepath.Clean(rel)
		if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
			return fmt.Errorf("%s: rendered link escapes site: %q", page, match[1])
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("%s: rendered link %q: %w", page, match[1], err)
		}
		if target.Fragment == "" {
			continue
		}
		found := false
		for _, id := range regexp.MustCompile(`\bid="([^"]*)"`).FindAllSubmatch(data, -1) {
			if html.UnescapeString(string(id[1])) == target.Fragment {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%s: rendered link anchor does not exist: %q", page, match[1])
		}
	}
	return nil
}
