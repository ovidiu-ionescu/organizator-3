use std::net::SocketAddr;

use log::trace;
use serde::Deserialize;
use tracing::{info, warn};

/// Read the settings file and return a Settings struct.
///

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct PostgresConfig {
    pub user: String,
    pub password: String,
    pub host: String,
    pub port: u16,
    pub dbname: String,
    // The name of the application as it will appear in the Postgres logs.
    pub application_name: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SecurityConfig {
    /// The number of seconds a session is valid for.
    pub session_expiry: u64,
    /// The number of seconds a session can be refreshed after it has expired.
    pub session_expiry_grace_period: u64,
    #[serde(rename = "ignore")]
    pub ignore_paths: Vec<String>,
    /// Get the public key from here
    pub public_key_url: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct FileStorage {
    pub path: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    api_ip: String,
    metrics_ip: String,
    pub postgres: PostgresConfig,
    pub security: SecurityConfig,
    pub file_storage: FileStorage,
    pub swagger_path: String,
}

#[must_use]
fn read_config() -> Settings {
    let Some(config_string) = get_config_content() else {
        warn!("Could not open config file, using defaults");
        return Settings::default();
    };
    let config: Settings = parse_config(&config_string);
    info!("Config file read {:?}", config);
    config
}

#[must_use]
fn parse_config(text: &str) -> Settings {
    toml::from_str(text).unwrap()
}

impl Settings {
    pub fn api_ip(&self) -> SocketAddr {
        self.api_ip.parse().unwrap()
    }

    pub fn metrics_ip(&self) -> SocketAddr {
        self.metrics_ip.parse().unwrap()
    }

    pub fn new() -> Settings {
        read_config()
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            api_ip: "127.0.0.1:3000".to_string(),
            metrics_ip: "127.0.0.1:3001".to_string(),
            postgres: PostgresConfig::default(),
            security: SecurityConfig::default(),
            file_storage: FileStorage {
                path: "/tmp".to_string(),
            },
            swagger_path: "/swagger-ui".to_string(),
        }
    }
}

impl Default for PostgresConfig {
    fn default() -> Self {
        trace!("Get default settings for PostgresConfig");
        let pwd_env_var = "POSTGRES_PASSWORD";
        let postgres_password = get_secret("postgres_password").unwrap_or_else(
          |e| std::env::var(pwd_env_var).unwrap_or_else(|_| panic!("Could not get postgres password from secrets: 「{e}」 or from environment variable {pwd_env_var} while getting default settings")
        ));
        PostgresConfig {
            user: "postgres".to_string(),
            password: postgres_password,
            host: "postgres_server".to_string(),
            port: 5432,
            dbname: "postgres".to_string(),
            application_name: "organizator".to_string(),
        }
    }
}

impl Default for SecurityConfig {
    fn default() -> Self {
        SecurityConfig {
            session_expiry: 3600,
            session_expiry_grace_period: 300,
            ignore_paths: vec![],
            public_key_url: None,
        }
    }
}

// test module
#[cfg(test)]
mod tests {
    use super::*;
    use indoc::indoc;

    #[test]
    fn test_read_config() {
        let config = read_config();
        assert_eq!(config.api_ip, "127.0.0.1:3000");
    }

    #[test]
    fn test_parse_config() {
        let config = parse_config(indoc! {r#"
            [postgres]
            user = "user"
            password = "password"
            host = "host"
            port = 5432
            dbname = "db"
        "#});
        assert_eq!(config.postgres.user, "user");
    }
}

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn get_secret(secret_name: &str) -> Result<String, Box<dyn std::error::Error>> {
    // 1. Priority: Manual override for local development
    if let Ok(override_path) = env::var("SECRET_OVERRIDE_PATH") {
        let path = Path::new(&override_path).join(secret_name);
        return Ok(fs::read_to_string(path)?.trim().to_string());
    }

    // 2. systemd standard: $CREDENTIALS_DIRECTORY
    // This works for both --system and --user services automatically
    if let Ok(creds_dir) = env::var("CREDENTIALS_DIRECTORY") {
        let path = PathBuf::from(creds_dir).join(secret_name);
        if path.exists() {
            log::info!("Reading secret from : {:?}", path);
            return Ok(fs::read_to_string(path)?.trim().to_string());
        }
    }

    Err("Secret not found in override or systemd credentials directory".into())
}

fn get_config_content() -> Option<String> {
    let file_name = "settings.toml";
    let app_name = get_app_name().to_lowercase().replace(" ", "_");
    log::debug!("App name for config paths: {}", app_name);
    // make  a list of possible config paths in order of priority
    let possible_paths = [
        env::var("CONFIG_PATH").ok().map(|s| PathBuf::from(&s)),
        Some(PathBuf::from(file_name)),
        dirs::config_local_dir()
            .map(|p| p.join(&app_name))
            .map(|p| p.join(file_name)),
        Some(PathBuf::from("/etc"))
            .map(|p| p.join(&app_name))
            .map(|p| p.join(file_name)),
    ];

    log::debug!("Possible config paths: {:?}", possible_paths);
    possible_paths
        .iter()
        .flatten() // get content out, skip nones
        .find(|p| p.exists())?
        .to_str()
        .and_then(|p| {
            log::info!("Trying to read config from: {:?}", p);
            fs::read_to_string(p).ok()
        })
}

fn get_app_name() -> String {
    let exe = env::current_exe()
        .ok()
        .and_then(|p| p.file_stem()?.to_str().map(|s| s.to_string()));

    env::var("APP_NAME")
        .unwrap_or_else(|_| exe.unwrap_or_else(|| "organizator_unknown_app".to_string()))
}
