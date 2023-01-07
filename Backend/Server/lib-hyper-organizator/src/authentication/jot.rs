use crate::settings::SecurityConfig;
use crate::typedef::GenericError;
use jsonwebtoken::{
    decode, encode, get_current_timestamp, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use tracing::debug;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: u64,
}

pub struct Jot {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    pub session_expiry: u64,
    pub session_expiry_grace_period: u64,
    public_key: String,
    ignore_paths: Vec<String>,
}

pub enum ExpiredToken {
    Valid,
    GracePeriod,
    Expired,
}

impl Jot {
    pub fn new(security_config: &SecurityConfig) -> Result<Jot, GenericError> {
        let document = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())?;
        let encoding_key = EncodingKey::from_ed_der(document.as_ref());
        let pair = Ed25519KeyPair::from_pkcs8(document.as_ref())?;
        let decoding_key = DecodingKey::from_ed_der(pair.public_key().as_ref());

        let session_expiry = security_config.session_expiry;
        let session_expiry_grace_period = security_config.session_expiry_grace_period;

        let public_key = base64::encode(pair.public_key().as_ref());

        Ok(Jot {
            encoding_key,
            decoding_key,
            session_expiry,
            session_expiry_grace_period,
            public_key,
            ignore_paths: security_config.ignore_paths.clone(),
        })
    }

    pub fn from_ed_der(
        public_key: &[u8],
        security_config: &SecurityConfig,
    ) -> Result<Jot, GenericError> {
        let decoding_key = DecodingKey::from_ed_der(public_key);
        Ok(Jot {
            encoding_key: EncodingKey::from_ed_der(public_key),
            decoding_key,
            session_expiry: security_config.session_expiry,
            session_expiry_grace_period: security_config.session_expiry_grace_period,
            public_key: base64::encode(public_key),
            ignore_paths: security_config.ignore_paths.clone(),
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

    pub fn generate_token(&self, user_id: &str) -> Result<String, GenericError> {
        let exp = get_current_timestamp() + self.session_expiry + self.session_expiry_grace_period;
        let claims = Claims {
            sub: user_id.to_string(),
            exp,
        };
        Ok(encode(
            &Header::new(Algorithm::EdDSA),
            &claims,
            &self.encoding_key,
        )?)
    }

    pub fn refresh_token(&self, token: &str) -> Result<String, GenericError> {
        let claims = self.validate_token(token)?;
        let exp = get_current_timestamp() + self.session_expiry + self.session_expiry_grace_period;
        let claims = Claims {
            sub: claims.sub,
            exp,
        };
        Ok(encode(
            &Header::new(Algorithm::EdDSA),
            &claims,
            &self.encoding_key,
        )?)
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims, GenericError> {
        let validation = Validation::new(Algorithm::EdDSA);
        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)?;
        Ok(token_data.claims)
    }

    pub fn get_public_key(&self) -> String {
        self.public_key.clone()
    }

    pub fn is_ignored_path(&self, path: &str) -> bool {
        self.ignore_paths.contains(&path.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoding() {
        let security_config = SecurityConfig::default();
        let jot = Jot::new(&security_config).unwrap();
        let token = jot.generate_token("admin").unwrap();
        println!("{}", token);

        let user_id = jot.validate_token(&token).unwrap().sub;
        assert_eq!(user_id, "admin");
    }
}
