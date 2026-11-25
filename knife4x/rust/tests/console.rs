use base64::{Engine, engine::general_purpose::STANDARD};
use knife4x::{BasicAuth, Console, Knife4xConfig, MarkdownDocument, Spec, UiSettings};
use serde_json::{Value, json};

fn page_config(console: &Console, path: &str) -> (Value, String) {
    let page = console.asset(path).unwrap();
    let html = String::from_utf8(page.body.to_vec()).unwrap();
    let (_, config) = html
        .split_once("<script>window.__KNIFE4X_CONFIG__=")
        .unwrap();
    let (json, after) = config.split_once(";</script>").unwrap();
    assert!(after.contains("<script type=\"module\""));
    (serde_json::from_str(json).unwrap(), html)
}

#[test]
fn single_spec_uses_root_and_only_serves_real_assets() {
    let console = Console::new(Knife4xConfig::new("/api.json")).unwrap();
    assert_eq!(
        page_config(&console, "/doc.html").0,
        json!({"specUrl":"/api.json", "basePath":"/"})
    );
    assert!(!console.requires_auth("/api.json"));
    assert_eq!(console.challenge(), None);
    assert!(console.asset("/index.html").is_none());
    assert!(console.asset("/business").is_none());
    let paths: Vec<_> = console.paths().collect();
    assert!(paths.iter().any(|p| p.contains("schemaDocumentWorker-")));
    assert!(paths.iter().any(|p| p == "/oauth2-redirect.html"));
    for path in paths {
        let asset = console.asset(&path).unwrap();
        assert!(!asset.body.is_empty());
        assert_ne!(asset.content_type, "application/octet-stream");
    }
}

#[test]
fn renders_ordered_groups_ui_options_and_markdown_without_markup_in_the_script() {
    let settings = UiSettings {
        language: Some("zh-CN".into()),
        enable_debug: Some(false),
        enable_search: Some(true),
        enable_open_api: Some(false),
        enable_request_cache: Some(true),
        enable_version: Some(false),
        enable_models: Some(true),
        enable_document_manage: Some(false),
        enable_group: Some(true),
        enable_footer: Some(false),
        enable_custom_footer: Some(true),
        enable_custom_home: Some(true),
        home_markdown: Some("Home".into()),
        footer_markdown: Some("Footer".into()),
    };
    let markdown = "code example: </script> & <meta>";
    let console = Console::new(
        Knife4xConfig::from_specs([
            Spec::new(" 示例 ", "relative.json"),
            Spec::new("public", "https://api.example/books"),
        ])
        .base_path("/internal/")
        .ui_settings(settings)
        .documents([MarkdownDocument::new(" Guide ", markdown)]),
    )
    .unwrap();
    let (config, html) = page_config(&console, "/internal/doc.html");
    assert_eq!(
        config,
        json!({
            "basePath":"/internal",
            "specs":[{"name":"示例","url":"relative.json"},{"name":"public","url":"https://api.example/books"}],
            "settings":{"language":"zh-CN","enableDebug":false,"enableSearch":true,"enableOpenApi":false,
                "enableRequestCache":true,"enableVersion":false,"enableSwaggerModels":true,
                "enableDocumentManage":false,"enableGroup":true,"enableFooter":false,"enableFooterCustom":true,
                "enableHomeCustom":true,"homeCustomLocation":"Home","footerCustomContent":"Footer"},
            "documents":[{"title":"Guide","content":markdown}]
        })
    );
    assert!(!html.contains(markdown));
    assert!(console.asset("/doc.html").is_none());
}

#[test]
fn validation_reports_bad_configuration_before_serving() {
    for config in [
        Knife4xConfig::new(" "),
        Knife4xConfig::new("//example.org/spec"),
        Knife4xConfig::new("ftp://example.org/spec"),
        Knife4xConfig::new("http:/example.org"),
        Knife4xConfig::new("https://admin@example.org/spec"),
        Knife4xConfig::new("spec\\path"),
        Knife4xConfig::new("/api").base_path("internal"),
        Knife4xConfig::new("/api").base_path("/bad/../prefix"),
        Knife4xConfig::from_specs([]),
        Knife4xConfig::from_specs([Spec::new("group", "/spec")]),
        Knife4xConfig::from_specs([Spec::new("a", "/one"), Spec::new(" a ", "/two")]),
        Knife4xConfig::new("/api").documents([MarkdownDocument::new("", "")]),
    ] {
        assert!(Console::new(config).is_err());
    }
}

#[test]
fn document_access_covers_configured_local_paths_and_keeps_credentials_server_side() {
    assert!(BasicAuth::new("a:b", "test").is_err());
    assert!(BasicAuth::new("docs", "").is_err());
    assert!(
        BasicAuth::new("docs", "test")
            .unwrap()
            .realm("bad\nvalue")
            .is_err()
    );
    let user = "demo";
    let pass = "private-document-credential";
    let auth = BasicAuth::new(user, pass).unwrap().realm("Docs").unwrap();
    let config = Knife4xConfig::from_specs([
        Spec::new("local", "books.json?v=1"),
        Spec::new("root", "/api/schema"),
        Spec::new("remote", "https://example.org/remote.json"),
    ])
    .basic_auth(auth)
    .base_path("/internal");
    let console = Console::new(config).unwrap();
    let (_, html) = page_config(&console, "/internal/doc.html");
    assert!(!html.contains(pass));
    assert_eq!(
        console.challenge(),
        Some(r#"Basic realm="Docs", charset="UTF-8""#)
    );
    assert!(console.paths().all(|p| console.requires_auth(&p)));
    assert!(console.requires_auth("/internal/books.json"));
    assert!(console.requires_auth("/api/schema"));
    assert!(!console.requires_auth("/remote.json"));
    assert!(!console.requires_auth("/business"));
    assert!(!console.authorized(None));
    assert!(!console.authorized(Some("Bearer sample")));
    let header = format!("Basic {}", STANDARD.encode(format!("{user}:{pass}")));
    assert!(console.authorized(Some(&header)));
    assert!(!console.authorized(Some(&format!("Basic {}", STANDARD.encode("demo:wrong")))));
}
