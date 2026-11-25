use crate::{BasicAuth, ConfigError};
use serde::Serialize;
use std::collections::HashSet;
use url::{ParseError, Url};

/// An ordered entry in the shared UI's document selector.
#[derive(Clone, Debug, Serialize)]
pub struct Spec {
    pub name: String,
    pub url: String,
}

impl Spec {
    pub fn new(name: impl Into<String>, url: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            url: url.into(),
        }
    }
}

/// An additional Markdown document shown in every group.
#[derive(Clone, Debug, Serialize)]
pub struct MarkdownDocument {
    pub title: String,
    pub content: String,
}

impl MarkdownDocument {
    pub fn new(title: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            content: content.into(),
        }
    }
}

/// Defaults passed to the shared UI. Unset fields inherit its existing behavior.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_debug: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_open_api: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_request_cache: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_version: Option<bool>,
    #[serde(
        rename = "enableSwaggerModels",
        skip_serializing_if = "Option::is_none"
    )]
    pub enable_models: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_document_manage: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_group: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_footer: Option<bool>,
    #[serde(rename = "enableFooterCustom", skip_serializing_if = "Option::is_none")]
    pub enable_custom_footer: Option<bool>,
    #[serde(rename = "enableHomeCustom", skip_serializing_if = "Option::is_none")]
    pub enable_custom_home: Option<bool>,
    #[serde(rename = "homeCustomLocation", skip_serializing_if = "Option::is_none")]
    pub home_markdown: Option<String>,
    #[serde(
        rename = "footerCustomContent",
        skip_serializing_if = "Option::is_none"
    )]
    pub footer_markdown: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum Source {
    SpecUrl(String),
    Specs(Vec<Spec>),
}

/// Runtime settings shared by every framework adapter.
#[derive(Clone)]
pub struct Knife4xConfig {
    source: Source,
    base_path: String,
    auth: Option<BasicAuth>,
    settings: Option<UiSettings>,
    documents: Vec<MarkdownDocument>,
}

impl Knife4xConfig {
    pub fn new(url: impl Into<String>) -> Self {
        Self::with_source(Source::SpecUrl(url.into()))
    }

    pub fn from_specs(specs: impl IntoIterator<Item = Spec>) -> Self {
        Self::with_source(Source::Specs(specs.into_iter().collect()))
    }

    fn with_source(source: Source) -> Self {
        Self {
            source,
            base_path: "/".into(),
            auth: None,
            settings: None,
            documents: Vec::new(),
        }
    }

    /// Set the public UI mount prefix. Defaults to `/`.
    pub fn base_path(mut self, path: impl Into<String>) -> Self {
        self.base_path = path.into();
        self
    }

    pub fn basic_auth(mut self, auth: BasicAuth) -> Self {
        self.auth = Some(auth);
        self
    }

    pub fn ui_settings(mut self, settings: UiSettings) -> Self {
        self.settings = Some(settings);
        self
    }

    pub fn documents(mut self, documents: impl IntoIterator<Item = MarkdownDocument>) -> Self {
        self.documents = documents.into_iter().collect();
        self
    }

    pub(crate) fn prepare(mut self) -> Result<Prepared, ConfigError> {
        let base = mount_url(&self.base_path)?;
        let base_path = base.path().trim_end_matches('/');
        let mut local_specs = Vec::new();
        match &mut self.source {
            Source::SpecUrl(url) => validate_url(url, &base, &mut local_specs)?,
            Source::Specs(specs) => {
                if specs.is_empty() {
                    return Err(ConfigError("at least one spec is required"));
                }
                let mut names = HashSet::new();
                for spec in specs {
                    spec.name = spec.name.trim().to_owned();
                    if matches!(spec.name.as_str(), "" | "." | ".." | "group")
                        || spec.name.contains(['/', '\\', '?', '#', '%'])
                        || spec.name.chars().any(char::is_control)
                        || !names.insert(&spec.name)
                    {
                        return Err(ConfigError(
                            "group names must be unique, valid route segments",
                        ));
                    }
                    validate_url(&mut spec.url, &base, &mut local_specs)?;
                }
            }
        }
        for doc in &mut self.documents {
            doc.title = doc.title.trim().to_owned();
            if doc.title.is_empty() {
                return Err(ConfigError("document title must not be empty"));
            }
        }

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Bootstrap<'a> {
            #[serde(flatten)]
            source: Source,
            base_path: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            settings: Option<UiSettings>,
            #[serde(skip_serializing_if = "Vec::is_empty")]
            documents: Vec<MarkdownDocument>,
        }
        let config = Bootstrap {
            source: self.source,
            base_path: if base_path.is_empty() { "/" } else { base_path },
            settings: self.settings,
            documents: self.documents,
        };
        let json = serde_json::to_string(&config)
            .map_err(|_| ConfigError("could not serialize browser configuration"))?;
        Ok(Prepared {
            prefix: base_path.into(),
            auth: self.auth,
            local_specs,
            json,
        })
    }
}

pub(crate) struct Prepared {
    pub(crate) prefix: String,
    pub(crate) auth: Option<BasicAuth>,
    pub(crate) local_specs: Vec<String>,
    pub(crate) json: String,
}

fn mount_url(path: &str) -> Result<Url, ConfigError> {
    let invalid = ConfigError("base path must be a clean absolute URL path");
    if !path.is_empty() && !path.starts_with('/')
        || path.starts_with("//")
        || path.trim() != path
        || path.contains(['?', '#', '\\'])
        || path.chars().any(char::is_control)
    {
        return Err(invalid);
    }
    let prefix = path.trim_end_matches('/');
    let base = Url::parse(&format!("http://knife4x.invalid{prefix}/")).map_err(|_| invalid)?;
    if prefix.contains("//")
        || prefix.split('/').any(|part| {
            let decoded = percent_encoding::percent_decode_str(part).decode_utf8_lossy();
            matches!(decoded.as_ref(), "." | "..") || decoded.contains(['/', '\\'])
        })
    {
        return Err(invalid);
    }
    Ok(base)
}

fn validate_url(
    value: &mut String,
    base: &Url,
    local: &mut Vec<String>,
) -> Result<(), ConfigError> {
    let trimmed = value.trim();
    let invalid = ConfigError("spec URL must be a relative or HTTP(S) URL without credentials");
    if trimmed.is_empty()
        || trimmed.starts_with("//")
        || trimmed.contains('\\')
        || trimmed.chars().any(char::is_control)
    {
        return Err(invalid);
    }
    match Url::parse(trimmed) {
        Ok(url) => {
            let Some(rest) = trimmed
                .split_once(':')
                .and_then(|(_, rest)| rest.strip_prefix("//"))
            else {
                return Err(invalid);
            };
            let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
            if !matches!(url.scheme(), "https" | "http")
                || url.host().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || authority.is_empty()
                || authority.contains('@')
            {
                return Err(invalid);
            }
        }
        Err(ParseError::RelativeUrlWithoutBase) => {
            let resolved = base.join(trimmed).map_err(|_| invalid)?;
            local.push(crate::auth::canonical_path(resolved.path()));
        }
        Err(_) => return Err(invalid),
    }
    *value = trimmed.to_owned();
    Ok(())
}
