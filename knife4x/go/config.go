package knife4x

import (
	"fmt"
	"io/fs"
	"strings"
	"unicode"
)

// Spec identifies one document in the ordered group selector.
type Spec struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// UISettings configures supported shared-UI defaults. A nil boolean preserves
// the UI default; a pointer to false explicitly disables that option. These are
// presentation preferences, not authorization controls.
type UISettings struct {
	Language             string `json:"language,omitempty"`
	EnableDebug          *bool  `json:"enableDebug,omitempty"`
	EnableSearch         *bool  `json:"enableSearch,omitempty"`
	EnableOpenAPI        *bool  `json:"enableOpenApi,omitempty"`
	EnableRequestCache   *bool  `json:"enableRequestCache,omitempty"`
	EnableVersion        *bool  `json:"enableVersion,omitempty"`
	EnableModels         *bool  `json:"enableSwaggerModels,omitempty"`
	EnableDocumentManage *bool  `json:"enableDocumentManage,omitempty"`
	EnableGroup          *bool  `json:"enableGroup,omitempty"`
	EnableFooter         *bool  `json:"enableFooter,omitempty"`
	EnableCustomFooter   *bool  `json:"enableFooterCustom,omitempty"`
	EnableCustomHome     *bool  `json:"enableHomeCustom,omitempty"`
	HomeMarkdown         string `json:"homeCustomLocation,omitempty"`
	FooterMarkdown       string `json:"footerCustomContent,omitempty"`
}

// MarkdownDocument provides an additional document either inline or from FS and
// Path (for example, an embed.FS). Files are read once by NewHandler. An empty
// inline Content is allowed. FS and Path must be supplied together.
type MarkdownDocument struct {
	Title   string
	Content string
	FS      fs.FS
	Path    string
}

type browserDocument struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func prepareBrowserConfig(cfg Config, basePath string) (browserConfig, error) {
	browser := browserConfig{BasePath: basePath, Settings: cfg.UISettings}
	if len(cfg.Specs) != 0 {
		if cfg.SpecURL != "" {
			return browser, fmt.Errorf("knife4x: SpecURL and Specs are mutually exclusive")
		}
		names := make(map[string]bool, len(cfg.Specs))
		browser.Specs = make([]Spec, len(cfg.Specs))
		for i, spec := range cfg.Specs {
			name := strings.TrimSpace(spec.Name)
			if name == "" || names[name] {
				return browser, fmt.Errorf("knife4x: Specs[%d] must have a non-empty unique name", i)
			}
			if name == "." || name == ".." || name == "group" || strings.ContainsAny(name, `/\?#%`) || strings.ContainsFunc(name, unicode.IsControl) {
				return browser, fmt.Errorf("knife4x: Specs[%d] name must be usable as a single route segment", i)
			}
			names[name] = true
			value, err := normalizeSpecURL(spec.URL)
			if err != nil {
				return browser, fmt.Errorf("knife4x: Specs[%d]: %w", i, err)
			}
			browser.Specs[i] = Spec{Name: name, URL: value}
		}
	} else {
		value, err := normalizeSpecURL(cfg.SpecURL)
		if err != nil {
			return browser, err
		}
		browser.SpecURL = value
	}
	if setting := cfg.UISettings; setting != nil {
		switch setting.Language {
		case "", "zh-CN", "en-US", "ja-JP":
		default:
			return browser, fmt.Errorf("knife4x: UISettings.Language must be zh-CN, en-US, or ja-JP")
		}
	}
	for i, doc := range cfg.Documents {
		title := strings.TrimSpace(doc.Title)
		if title == "" {
			return browser, fmt.Errorf("knife4x: Documents[%d].Title must not be empty", i)
		}
		if (doc.FS == nil) != (doc.Path == "") {
			return browser, fmt.Errorf("knife4x: Documents[%d] requires both FS and Path", i)
		}
		content := doc.Content
		if doc.FS != nil {
			if content != "" {
				return browser, fmt.Errorf("knife4x: Documents[%d] cannot combine Content with FS and Path", i)
			}
			if !fs.ValidPath(doc.Path) {
				return browser, fmt.Errorf("knife4x: Documents[%d].Path must be a valid fs path", i)
			}
			data, err := fs.ReadFile(doc.FS, doc.Path)
			if err != nil {
				return browser, fmt.Errorf("knife4x: read Documents[%d]: %w", i, err)
			}
			content = string(data)
		}
		browser.Documents = append(browser.Documents, browserDocument{Title: title, Content: content})
	}
	return browser, nil
}
