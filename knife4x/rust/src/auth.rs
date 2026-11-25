use crate::ConfigError;
use base64::{Engine, engine::general_purpose::STANDARD};
use percent_encoding::percent_decode_str;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// HTTP Basic credentials for access to the documentation over HTTPS.
#[derive(Clone)]
pub struct BasicAuth {
    digest: [u8; 32],
    pub(crate) challenge: String,
}

impl BasicAuth {
    pub fn new(username: impl AsRef<str>, password: impl AsRef<str>) -> Result<Self, ConfigError> {
        let username = username.as_ref();
        let password = password.as_ref();
        if username.is_empty() || username.contains(':') || password.is_empty() {
            return Err(ConfigError(
                "Basic Auth needs a non-empty username without a colon and a non-empty password",
            ));
        }
        let digest = Sha256::new()
            .chain_update(username)
            .chain_update(":")
            .chain_update(password)
            .finalize()
            .into();
        Ok(Self {
            digest,
            challenge: r#"Basic realm="Knife4x", charset="UTF-8""#.into(),
        })
    }

    /// Override the default Knife4x authentication realm.
    pub fn realm(mut self, realm: impl AsRef<str>) -> Result<Self, ConfigError> {
        let realm = realm.as_ref();
        let realm = if realm.is_empty() { "Knife4x" } else { realm };
        if !realm.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
            return Err(ConfigError("Basic Auth realm must contain printable ASCII"));
        }
        let quoted = realm.replace('\\', "\\\\").replace('"', "\\\"");
        self.challenge = format!(r#"Basic realm="{quoted}", charset="UTF-8""#);
        Ok(self)
    }

    pub(crate) fn authorized(&self, header: Option<&str>) -> bool {
        let Some((scheme, value)) = header.and_then(|header| header.split_once(' ')) else {
            return false;
        };
        if !scheme.eq_ignore_ascii_case("Basic") {
            return false;
        }
        let Ok(credentials) = STANDARD.decode(value.trim_start_matches(' ')) else {
            return false;
        };
        let digest: [u8; 32] = Sha256::digest(credentials).into();
        bool::from(self.digest.ct_eq(&digest))
    }
}

// Only used to match access rules. The adapter forwards the original request URI.
pub(crate) fn canonical_path(path: &str) -> String {
    let decoded = percent_decode_str(path).decode_utf8_lossy();
    let mut parts = Vec::new();
    for part in decoded.split(['/', '\\']) {
        let part = part.split(';').next().unwrap_or_default();
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            name => parts.push(name),
        }
    }
    format!("/{}", parts.join("/"))
}
