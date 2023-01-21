use std::{fs::File, io::Read, net::SocketAddr};

use serde::Deserialize;
use tracing::{info, warn};

/// Read the settings file and return a Settings struct.
///

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct PostgresConfig {
    pub user:             String,
    pub password:         String,
    pub host:             String,
    pub port:             u16,
    pub dbname:           String,
    // The name of the application as it will appear in the Postgres logs.
    pub application_name: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SecurityConfig {
    /// The number of seconds a session is valid for.
    pub session_expiry:              u64,
    /// The number of seconds a session can be refreshed after it has expired.
    pub session_expiry_grace_period: u64,
    #[serde(rename = "ignore")]
    pub ignore_paths:                Vec<String>,
    /// Get the public key from here
    pub public_key_url:              Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(default)]
pub struct Settings {
    api_ip:       String,
    metrics_ip:   String,
    pub postgres: PostgresConfig,
    pub security: SecurityConfig,
}

#[must_use]
fn read_config() -> Settings {
    let config_file_name = "settings.toml";
    let Ok(mut config_file) = File::open(config_file_name) else {
        warn!("Could not open config file, using defaults");
        return Settings::default();
    };
    info!("Reading config file {}", config_file_name);
    let mut config_str = String::new();
    config_file.read_to_string(&mut config_str).unwrap();
    let config: Settings = parse_config(&config_str);
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
            api_ip:     "127.0.0.1:3000".to_string(),
            metrics_ip: "127.0.0.1:3001".to_string(),
            postgres:   PostgresConfig::default(),
            security:   SecurityConfig::default(),
        }
    }
}

impl Default for PostgresConfig {
    fn default() -> Self {
        let pwd_env_var = "POSTGRES_PASSWORD";
        let postgres_password = match std::env::var(&pwd_env_var) {
            Ok(password) => password,
            Err(e) => {
                warn!(
                    "Could not read {pwd_env_var} while getting default settings: {}",
                    e
                );
                "password".to_string()
            }
        };
        PostgresConfig {
            user:             "postgres".to_string(),
            password:         postgres_password,
            host:             "postgres_server".to_string(),
            port:             5432,
            dbname:           "postgres".to_string(),
            application_name: "organizator".to_string(),
        }
    }
}

impl Default for SecurityConfig {
    fn default() -> Self {
        SecurityConfig {
            session_expiry:              3600,
            session_expiry_grace_period: 300,
            ignore_paths:                vec![],
            public_key_url:              None,
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
