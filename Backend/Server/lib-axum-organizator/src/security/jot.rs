use std::fmt::{Display, Formatter};

use crate::app_error::AppError;
use crate::security::security_settings::SecurityConfig;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use jsonwebtoken::{
    Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode, get_current_timestamp,
};
use reqwest::Client;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};
use utoipa::ToSchema;

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct UserId(pub String);
impl Display for UserId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
#[derive(Debug, Clone)]
pub struct UserRoles(pub Vec<String>);

#[derive(Debug, Clone)]
pub struct User {
    pub id: UserId,
    pub roles: UserRoles,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: u64,
    pub roles: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ClaimsView<'a> {
    pub sub: &'a str,
    pub exp: u64,
    pub roles: &'a [&'a str],
}

impl User {
    pub fn new(id: &str, roles: Vec<&str>) -> Self {
        User {
            id: UserId(id.to_string()),
            roles: (UserRoles(roles.into_iter().map(|r| r.to_string()).collect())),
        }
    }
    pub fn has_role(&self, role: &str) -> bool {
        self.roles.0.contains(&role.to_string())
    }
    pub fn is_admin(&self) -> bool {
        self.has_role("orgadm")
    }
    pub fn id(&self) -> &str {
        &self.id.0
    }
    pub fn into_id(self) -> String {
      self.id.0
    }
}
impl From<Claims> for User {
    fn from(claims: Claims) -> Self {
        User {
            id: UserId(claims.sub),
            roles: UserRoles(claims.roles),
        }
    }
}

// jot is the official pronunciation of JWT
pub struct Jot {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    pub session_expiry: u64,
    pub session_expiry_grace_period: u64,
    public_key: String,
}

pub enum ExpiredToken {
    Valid,
    GracePeriod,
    Expired,
}

/// Struct to transfer the public key among processes
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PublicKey {
    pub algorithm: String,
    pub public_key: String,
}

#[derive(Debug, Deserialize)]
pub struct PublicKeyResponse {
    pub algorithm: String,
    pub public_key: String,
}

impl Jot {
    pub fn autogenerate(security_config: &SecurityConfig) -> Result<Jot, AppError> {
        info!("Generating new keypair");
        let document = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
            .map_err(|_| "could not generate pkcs8")?;
        let encoding_key = EncodingKey::from_ed_der(document.as_ref());
        let pair = Ed25519KeyPair::from_pkcs8(document.as_ref()).map_err(|_| "key was rejected")?;
        let decoding_key = DecodingKey::from_ed_der(pair.public_key().as_ref());

        let session_expiry = security_config.session_expiry;
        let session_expiry_grace_period = security_config.session_expiry_grace_period;

        let public_key = BASE64.encode(pair.public_key().as_ref());

        Ok(Jot {
            encoding_key,
            decoding_key,
            session_expiry,
            session_expiry_grace_period,
            public_key,
        })
    }

    pub fn from_ed_der(
        public_key: &[u8],
        security_config: &SecurityConfig,
    ) -> Result<Jot, AppError> {
        let decoding_key = DecodingKey::from_ed_der(public_key);
        Ok(Jot {
            encoding_key: EncodingKey::from_ed_der(public_key),
            decoding_key,
            session_expiry: security_config.session_expiry,
            session_expiry_grace_period: security_config.session_expiry_grace_period,
            public_key: BASE64.encode(public_key),
        })
    }

    pub fn check_expiration(&self, claims: &Claims) -> ExpiredToken {
        let now = get_current_timestamp();
        if claims.exp > now + self.session_expiry_grace_period {
            ExpiredToken::Valid
        } else if claims.exp > now {
            ExpiredToken::GracePeriod
        } else {
            debug!("claims.exp: {}, now: {}", claims.exp, now);
            ExpiredToken::Expired
        }
    }

    pub fn generate_token(&self, user_id: &str, roles: &[&str]) -> Result<String, AppError> {
        let exp = get_current_timestamp() + self.session_expiry + self.session_expiry_grace_period;
        let claims = ClaimsView {
            sub: user_id,
            exp,
            roles,
        };
        Ok(encode(
            &Header::new(Algorithm::EdDSA),
            &claims,
            &self.encoding_key,
        )?)
    }

    pub fn refresh_token(&self, token: &str) -> Result<String, AppError> {
        let claims = self.validate_token(token)?;
        let exp = get_current_timestamp() + self.session_expiry + self.session_expiry_grace_period;
        let claims = Claims {
            sub: claims.sub,
            exp,
            roles: claims.roles,
        };
        Ok(encode(
            &Header::new(Algorithm::EdDSA),
            &claims,
            &self.encoding_key,
        )?)
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims, AppError> {
        let validation = Validation::new(Algorithm::EdDSA);
        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)?;
        Ok(token_data.claims)
    }

    pub fn get_public_key(&self) -> PublicKey {
        PublicKey {
            algorithm: "EdDSA".to_string(),
            public_key: self.public_key.clone(),
        }
    }

    // creates a JOT out of a public key from the identity service
    pub async fn new(security_config: &SecurityConfig) -> Result<Jot, AppError> {
        // if this is the identity service, we have no public key url, so we generate a new keypair
        let Some(ref public_key_url) = security_config.public_key_url else {
            return Self::autogenerate(security_config);
        };

        // this is not the identity service, so we fetch the public key from the identity service
        //let uri = public_key_url.parse()?;

        let client = Client::new();
        let response: PublicKeyResponse = client
            .get(public_key_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let public_key_bytes = BASE64.decode(&response.public_key)?;
        info!("Got public key from identity service");

        let encoding_key = EncodingKey::from_ed_der(&public_key_bytes);
        Ok(Jot {
            encoding_key,
            decoding_key: DecodingKey::from_ed_der(&public_key_bytes),
            session_expiry: 0,
            session_expiry_grace_period: 0,
            public_key: "fake_public_key".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoding() {
        let security_config = SecurityConfig::default();
        let jot = Jot::autogenerate(&security_config).unwrap();
        let token = jot.generate_token("admin", &[]).unwrap();
        println!("{}", token);

        let user_id = jot.validate_token(&token).unwrap().sub;
        assert_eq!(user_id, "admin");
    }
}
