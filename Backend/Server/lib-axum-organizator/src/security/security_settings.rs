use serde::Deserialize;

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SecurityConfig {
    /// The number of seconds a session is valid for.
    pub session_expiry: u64,
    /// The number of seconds a session can be refreshed after it has expired.
    pub session_expiry_grace_period: u64,
    /// Get the public key from here
    pub public_key_url: Option<String>,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        SecurityConfig {
            session_expiry: 3600,
            session_expiry_grace_period: 300,
            public_key_url: None,
        }
    }
}

// test module
#[cfg(test)]
mod tests {
    use super::*;
    use indoc::indoc;
}
