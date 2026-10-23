use serde::Deserialize;

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SecurityConfig {
    /// The number of seconds a session is valid for.
    pub session_expiry: u64,
    /// The number of seconds a session can be refreshed after it has expired.
    pub session_expiry_grace_period: u64,
    /// The lifetime the login page's long-term checkbox asks for. A deployment that offers long
    /// term says so here; left unset it is no longer than an ordinary session.
    pub long_session_expiry: u64,
    /// The same refresh window as above, for the long-term session.
    pub long_session_expiry_grace_period: u64,
    /// Get the public key from here
    pub public_key_url: Option<String>,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        SecurityConfig {
            session_expiry: 3600,
            session_expiry_grace_period: 300,
            // Not a longer default: the length of a remembered login is the deployment's
            // decision, written in its settings, not a number baked into the code.
            long_session_expiry: 3600,
            long_session_expiry_grace_period: 300,
            public_key_url: None,
        }
    }
}
