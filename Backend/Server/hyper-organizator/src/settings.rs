use std::{fs::File, io::Read, net::SocketAddr};

use serde::Deserialize;
use tracing::{info, warn};

/// Read the settings file and return a Settings struct.
///
#[derive(Deserialize, Debug)]
#[serde(default)]
pub struct Settings {
    api_ip:     String,
    metrics_ip: String,
}

#[must_use]
fn read_config() -> Settings {
    let config_file_name = "settings.toml";
    let Ok(mut config_file) = File::open(&config_file_name) else {
        warn!("Could not open config file, using defaults");
        return Settings::default();
    };
    info!("Reading config file {}", config_file_name);
    let mut config_str = String::new();
    config_file.read_to_string(&mut config_str).unwrap();
    let config: Settings = toml::from_str(&config_str).unwrap();
    info!("Config file read {:?}", config);
    config
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
        }
    }
}

// test module
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_config() {
        let config = read_config();
        assert_eq!(config.api_ip, "127.0.0.1:3000");
    }
}