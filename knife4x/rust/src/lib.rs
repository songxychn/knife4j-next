//! Serve the shared Knife4j OpenAPI 3 console from an existing Rust service.
//! Construct a [Console] for framework-independent access, or enable the
//! `axum` Cargo feature and use `knife4x::axum::mount`.

mod auth;
mod config;

#[cfg(feature = "axum")]
pub mod axum;

pub use auth::BasicAuth;
pub use config::{Knife4xConfig, MarkdownDocument, Spec, UiSettings};

use bytes::Bytes;
use rust_embed::RustEmbed;
use std::{borrow::Cow, collections::HashSet, fmt};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Files;

/// An invalid host configuration or incompatible embedded UI.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct ConfigError(&'static str);

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "knife4x: {}", self.0)
    }
}

impl std::error::Error for ConfigError {}

/// A ready-to-serve document or embedded static file.
pub struct Asset {
    pub body: Bytes,
    pub content_type: &'static str,
}

/// A prepared console. Construct once and share across requests.
pub struct Console {
    prefix: String,
    index: Bytes,
    auth: Option<BasicAuth>,
    local_specs: Vec<String>,
    protected_assets: HashSet<String>,
}

impl Console {
    pub fn new(config: Knife4xConfig) -> Result<Self, ConfigError> {
        let config = config.prepare()?;
        // HTML parses the enclosing script element before JavaScript interprets
        // its string literals. Escape markup delimiters even in valid JSON.
        let json = config
            .json
            .replace('<', "\\u003c")
            .replace('>', "\\u003e")
            .replace('&', "\\u0026");
        let index = include_str!("../static/index.html");
        let module = index
            .find("<script type=\"module\"")
            .ok_or(ConfigError("embedded UI has no module script"))?;
        let mut html = index.to_owned();
        html.insert_str(
            module,
            &format!("<script>window.__KNIFE4X_CONFIG__={json};</script>\n    "),
        );
        let mut console = Self {
            prefix: config.prefix,
            index: html.into(),
            auth: config.auth,
            local_specs: config.local_specs,
            protected_assets: HashSet::new(),
        };
        if console.auth.is_some() {
            console.protected_assets = console.paths().map(|p| auth::canonical_path(&p)).collect();
        }
        Ok(console)
    }

    /// Every public UI path, including the configured entry and its resources.
    pub fn paths(&self) -> impl Iterator<Item = String> + '_ {
        Files::iter().map(|name| {
            let public = if name == "index.html" {
                "doc.html"
            } else {
                &name
            };
            format!("{}/{public}", self.prefix)
        })
    }

    /// Look up a URI path (without a query). Unknown files belong to the host.
    pub fn asset(&self, path: &str) -> Option<Asset> {
        let name = path.strip_prefix(&self.prefix)?.strip_prefix('/')?;
        if name == "doc.html" {
            return Some(Asset {
                body: self.index.clone(),
                content_type: "text/html; charset=utf-8",
            });
        }
        if name == "index.html"
            || name.split('/').any(|part| matches!(part, "" | "." | ".."))
            || name.contains('\\')
        {
            return None;
        }
        let file = Files::get(name)?;
        let body = match file.data {
            Cow::Borrowed(data) => Bytes::from_static(data),
            Cow::Owned(data) => Bytes::from(data),
        };
        Some(Asset {
            body,
            content_type: mime_guess::from_path(name)
                .first_raw()
                .unwrap_or("application/octet-stream"),
        })
    }

    /// Whether a path requires the configured documentation credentials.
    /// Apply this to local spec requests as well as embedded assets.
    pub fn requires_auth(&self, path: &str) -> bool {
        if self.auth.is_none() {
            return false;
        }
        let path = auth::canonical_path(path);
        self.protected_assets.contains(&path)
            || self.local_specs.iter().any(|spec| {
                path == *spec
                    || path
                        .strip_prefix(spec)
                        .is_some_and(|tail| spec != "/" && tail.starts_with('/'))
            })
    }

    /// Validate the Authorization header of a protected request.
    pub fn authorized(&self, header: Option<&str>) -> bool {
        self.auth
            .as_ref()
            .is_none_or(|auth| auth.authorized(header))
    }

    /// The WWW-Authenticate header value for an unauthorized request.
    pub fn challenge(&self) -> Option<&str> {
        self.auth.as_ref().map(|auth| auth.challenge.as_str())
    }
}
