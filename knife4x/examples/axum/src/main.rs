use std::{env, error::Error};

use axum::{Router, http::header, routing::get};
use knife4x::{BasicAuth, Knife4xConfig};
use utoipa::openapi::Info;
use utoipa_axum::{router::OpenApiRouter, routes};

#[utoipa::path(
    get,
    path = "/api/ping",
    responses((status = 200, description = "服务可用", body = String))
)]
async fn ping() -> &'static str {
    "pong"
}

// #region app
fn app(config: Knife4xConfig) -> Result<Router, Box<dyn Error>> {
    let (app, mut openapi) = OpenApiRouter::default()
        .routes(routes!(ping))
        .split_for_parts();
    openapi.info = Info::new("Knife4x Axum 示例", env!("CARGO_PKG_VERSION"));
    let json = openapi.to_json()?;
    let app = app.route(
        "/openapi.json",
        get(move || async move { ([(header::CONTENT_TYPE, "application/json")], json) }),
    );
    Ok(knife4x::axum::mount(app, config)?)
}
// #endregion app

fn optional_env(key: &str) -> Result<Option<String>, env::VarError> {
    match env::var(key) {
        Ok(value) => Ok(Some(value)),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(err) => Err(err),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut config = Knife4xConfig::new("/openapi.json");
    if let Some(prefix) = optional_env("KNIFE4X_BASE_PATH")? {
        config = config.base_path(prefix);
    }
    match (
        optional_env("KNIFE4X_BASIC_USER")?,
        optional_env("KNIFE4X_BASIC_PASSWORD")?,
    ) {
        (Some(user), Some(password)) => config = config.basic_auth(BasicAuth::new(user, password)?),
        (None, None) => {}
        _ => {
            return Err(
                "KNIFE4X_BASIC_USER and KNIFE4X_BASIC_PASSWORD must be set together".into(),
            );
        }
    }
    let app = app(config)?;
    let addr = optional_env("KNIFE4X_ADDR")?.unwrap_or_else(|| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Knife4x Axum listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        extract::Request,
        http::StatusCode,
    };
    use tower::ServiceExt;

    async fn get_body(app: &Router, path: &str) -> String {
        let request = Request::builder().uri(path).body(Body::empty()).unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        String::from_utf8(
            to_bytes(response.into_body(), 1024 * 1024)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn documents_a_working_axum_operation() {
        for prefix in ["/", "/internal"] {
            let app = app(Knife4xConfig::new("/openapi.json").base_path(prefix)).unwrap();
            let page = format!("{}/doc.html", prefix.trim_end_matches('/'));
            assert!(get_body(&app, &page).await.contains("__KNIFE4X_CONFIG__"));
            let spec: serde_json::Value =
                serde_json::from_str(&get_body(&app, "/openapi.json").await).unwrap();
            assert!(spec["paths"]["/api/ping"]["get"]["responses"]["200"].is_object());
            assert_eq!(get_body(&app, "/api/ping").await, "pong");
        }
    }
}
