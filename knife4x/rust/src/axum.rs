//! Mount the embedded console on an Axum application.

use std::sync::Arc;

use ::axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{Next, from_fn_with_state},
    response::{IntoResponse, Response},
};

use crate::{ConfigError, Console, Knife4xConfig};

/// Attach the console after registering all host routes, including local OpenAPI
/// documents. A configured Basic Auth policy then covers both the console and
/// those document routes. Apply any outer application middleware afterwards.
pub fn mount<S>(app: Router<S>, config: Knife4xConfig) -> Result<Router<S>, ConfigError>
where
    S: Clone + Send + Sync + 'static,
{
    let console = Arc::new(Console::new(config)?);
    Ok(app.layer(from_fn_with_state(console, handle)))
}

async fn handle(State(console): State<Arc<Console>>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let protected = console.challenge().filter(|_| console.requires_auth(path));
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());

    let mut response =
        if let Some(challenge) = protected.filter(|_| !console.authorized(authorization)) {
            (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, challenge)],
            )
                .into_response()
        } else if matches!(*request.method(), Method::GET | Method::HEAD)
            && let Some(asset) = console.asset(path)
        {
            let length = asset.body.len();
            let body = if request.method() == Method::HEAD {
                Body::empty()
            } else {
                Body::from(asset.body)
            };
            let mut response = Response::new(body);
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(asset.content_type),
            );
            response
                .headers_mut()
                .insert(header::CONTENT_LENGTH, length.into());
            response
        } else {
            next.run(request).await
        };

    if protected.is_some() {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        );
    }
    response
}
