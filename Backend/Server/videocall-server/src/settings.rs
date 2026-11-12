use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;

use serde::Deserialize;
use tracing::{info, warn};

use lib_axum_organizator::security::security_settings::SecurityConfig;

/// The settings of the signaling service.
///
/// Rooms are in memory, so there is no Postgres section: the identity service owns the users and
/// this service only verifies the cookie it signs. The security block still has to carry the
/// identity service's public key URL and lifetimes, because the shared `Jot` reads them.
#[derive(Clone, Debug, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub api_ip: String,
    /// How many sockets one room may hold.
    pub max_participants: usize,
    /// The longest chat message accepted, in characters.
    pub chat_max_chars: usize,
    /// Browser origins allowed to open the WebSocket. An empty list disables the check, which is
    /// what local tests use; the deployed file names the origins.
    pub allowed_origins: Vec<String>,
    pub security: SecurityConfig,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_ip: "127.0.0.1:8083".to_string(),
            max_participants: 12,
            chat_max_chars: 2000,
            allowed_origins: Vec::new(),
            security: SecurityConfig::default(),
        }
    }
}

impl Settings {
    pub fn api_ip(&self) -> SocketAddr {
        self.api_ip.parse().expect("api_ip is not a socket address")
    }

    /// The first of `CONFIG_PATH`, `./settings.toml`, and `/etc/videocall-server/settings.toml`
    /// that exists. A missing file is not fatal: the defaults let the unit tests run without a
    /// deployment, and the warning says what the service is missing.
    pub fn new() -> Self {
        let paths = [
            env::var("CONFIG_PATH").ok().map(PathBuf::from),
            Some(PathBuf::from("settings.toml")),
            Some(PathBuf::from("/etc/videocall-server/settings.toml")),
        ];
        for path in paths.into_iter().flatten() {
            if !path.exists() {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(text) => {
                    info!("Reading settings from {}", path.display());
                    return toml::from_str(&text)
                        .unwrap_or_else(|e| panic!("Could not parse {}: {e}", path.display()));
                }
                Err(e) => warn!("Could not read {}: {e}", path.display()),
            }
        }
        warn!("No videocall settings file found; using defaults");
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_settings_file_shape() {
        let settings: Settings = toml::from_str(
            r#"
            api_ip = "127.0.0.1:9999"
            max_participants = 4
            chat_max_chars = 50
            allowed_origins = ["https://example.test"]

            [security]
            public_key_url = "http://localhost:8080/public"
            "#,
        )
        .unwrap();
        assert_eq!(settings.api_ip().port(), 9999);
        assert_eq!(settings.max_participants, 4);
        assert_eq!(settings.chat_max_chars, 50);
        assert_eq!(settings.allowed_origins, vec!["https://example.test"]);
        assert_eq!(
            settings.security.public_key_url.as_deref(),
            Some("http://localhost:8080/public")
        );
    }
}
