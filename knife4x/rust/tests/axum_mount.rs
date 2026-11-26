#![cfg(feature = "axum")]

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{Method, StatusCode, header},
    response::Response,
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use knife4x::{BasicAuth, Knife4xConfig, axum::mount};
use tower::ServiceExt;

fn host() -> Router<&'static str> {
    // The document is hosted under a nested router with its own state.
    let spec = Router::new().route(
        "/openapi.json",
        get(|State(content): State<&'static str>| async move {
            ([(header::CACHE_CONTROL, "public")], content)
        }),
    );
    Router::new()
        .nest("/api", spec)
        .route("/health", get(|| async { "ready" }))
        .fallback(|| async { (StatusCode::NOT_FOUND, "host fallback") })
}

async fn request(app: &Router, method: Method, path: &str, credentials: Option<&str>) -> Response {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(credentials) = credentials {
        let encoded = STANDARD.encode(credentials);
        request = request.header(header::AUTHORIZATION, format!("Basic {encoded}"));
    }
    app.clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn bytes(response: Response) -> Vec<u8> {
    to_bytes(response.into_body(), 16 << 20)
        .await
        .unwrap()
        .to_vec()
}

fn asset_reference<'a>(doc: &'a str, marker: &str, extension: &str) -> &'a str {
    doc.split(marker)
        .skip(1)
        .filter_map(|rest| rest.split_once('"').map(|(path, _)| path))
        .find(|path| path.starts_with("assets/") && path.ends_with(extension))
        .expect("document must reference the bundled asset")
}

#[tokio::test]
async fn serves_assets_with_correct_body_and_preserves_host_routes() {
    for prefix in ["", "/internal"] {
        let cfg = Knife4xConfig::new("/api/openapi.json").base_path(prefix);
        let app = mount(host(), cfg).unwrap().with_state("document");

        let path = format!("{prefix}/doc.html");
        let doc = request(&app, Method::GET, &path, None).await;
        assert_eq!(doc.status(), StatusCode::OK);
        let doc = String::from_utf8(bytes(doc).await).unwrap();
        assert!(doc.contains("window.__KNIFE4X_CONFIG__="));
        for (tail, mime) in [
            (asset_reference(&doc, r#"src="./"#, ".js"), "javascript"),
            (asset_reference(&doc, r#"href="./"#, ".css"), "text/css"),
            ("oauth2-redirect.html", "text/html"),
            ("knife4j-next-mark.svg", "image/svg+xml"),
        ] {
            let path = format!("{prefix}/{tail}");
            let get = request(&app, Method::GET, &path, None).await;
            assert_eq!(get.status(), StatusCode::OK);
            assert!(
                get.headers()[header::CONTENT_TYPE]
                    .to_str()
                    .unwrap()
                    .contains(mime)
            );
            let length = bytes(get).await.len();
            assert!(length > 0);

            let head = request(&app, Method::HEAD, &path, None).await;
            assert_eq!(head.status(), StatusCode::OK);
            assert_eq!(
                head.headers()[header::CONTENT_LENGTH].to_str().unwrap(),
                length.to_string()
            );
            assert!(bytes(head).await.is_empty());
        }
        assert_eq!(
            bytes(request(&app, Method::GET, "/api/openapi.json", None).await).await,
            b"document"
        );
        assert_eq!(
            bytes(request(&app, Method::GET, "/health", None).await).await,
            b"ready"
        );
        for (method, path) in [
            (Method::POST, format!("{prefix}/doc.html")),
            (Method::GET, format!("{prefix}/assets/missing.js")),
            (Method::GET, format!("{prefix}/index.html")),
        ] {
            let response = request(&app, method, &path, None).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            assert_eq!(bytes(response).await, b"host fallback");
        }
    }
}

#[tokio::test]
async fn protects_ui_and_local_spec_without_changing_business_routes() {
    let cfg = Knife4xConfig::new("../api/openapi.json?version=1")
        .base_path("/internal")
        .basic_auth(BasicAuth::new("reader", "doc-test-pass").unwrap());
    let app = mount(host(), cfg).unwrap().with_state("document");

    let doc = request(
        &app,
        Method::GET,
        "/internal/doc.html",
        Some("reader:doc-test-pass"),
    )
    .await;
    let doc = String::from_utf8(bytes(doc).await).unwrap();
    let script = format!("/internal/{}", asset_reference(&doc, r#"src="./"#, ".js"));
    for path in [
        "/internal/doc.html",
        &script,
        "/internal/oauth2-redirect.html",
        "/api/openapi.json",
    ] {
        for credentials in [None, Some("reader:incorrect")] {
            let response = request(&app, Method::GET, path, credentials).await;
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
            assert!(
                response.headers()[header::WWW_AUTHENTICATE]
                    .to_str()
                    .unwrap()
                    .contains("realm=\"Knife4x\"")
            );
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "private, no-store"
            );
        }
        let response = request(&app, Method::GET, path, Some("reader:doc-test-pass")).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
    }

    assert_eq!(
        request(&app, Method::HEAD, "/api/openapi.json", None)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let health = request(&app, Method::GET, "/health", None).await;
    assert_eq!(health.status(), StatusCode::OK);
    assert!(!health.headers().contains_key(header::CACHE_CONTROL));
}
