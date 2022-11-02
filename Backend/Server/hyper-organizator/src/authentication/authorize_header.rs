use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::env;
use std::error::Error;
use std::time::SystemTime;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: u64,
}

pub struct Jot {
    encoding_key:                    EncodingKey,
    decoding_key:                    DecodingKey,
    pub session_expiry:              u64,
    pub session_expiry_grace_period: u64,
}

pub enum ExpiredToken {
    Valid,
    GracePeriod,
    Expired,
}

impl Jot {
    pub fn new() -> Result<Jot, Box<dyn Error>> {
        let rng = SystemRandom::new();
        let mut bytes = [0u8; 32];
        rng.fill(&mut bytes)?;
        let encoding_key = EncodingKey::from_secret(&bytes);
        let decoding_key = DecodingKey::from_secret(&bytes);
        let session_expiry = env::var("SESSION_EXPIRY")
            .unwrap_or("3600".to_string())
            .parse::<u64>()
            .unwrap();
        let session_expiry_grace_period = env::var("SESSION_EXPIRY_GRACE_PERIOD")
            .unwrap_or("300".to_string())
            .parse::<u64>()
            .unwrap();

        Ok(Jot {
            encoding_key,
            decoding_key,
            session_expiry,
            session_expiry_grace_period,
        })
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("Time went backwards since epoch")
            .as_secs()
    }

    pub fn check_expiration(&self, claims: &Claims) -> ExpiredToken {
        let now = Jot::now();
        if claims.exp > now {
            ExpiredToken::Valid
        } else if claims.exp + self.session_expiry_grace_period > now {
            ExpiredToken::GracePeriod
        } else {
            println!("claims.exp: {}, now: {}", claims.exp, now);
            ExpiredToken::Expired
        }
    }

    pub fn generate_token(self: &Self, user_id: &str) -> Result<String, Box<dyn Error>> {
        let exp = Self::now() + self.session_expiry;
        let claims = Claims {
            sub: user_id.to_string(),
            exp,
        };
        Ok(encode(&Header::default(), &claims, &self.encoding_key)?)
    }

    pub fn validate_token(self: &Self, token: &str) -> Result<Claims, Box<dyn Error>> {
        let validation = Validation::new(Algorithm::HS256);
        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)?;
        Ok(token_data.claims)
    }

    pub fn refresh_token(self: &Self, token: &str) -> Result<String, Box<dyn Error>> {
        let validation = Validation::new(Algorithm::HS256);
        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)?;
        let exp = Self::now() + self.session_expiry;
        let claims = Claims {
            sub: token_data.claims.sub,
            exp,
        };
        Ok(encode(&Header::default(), &claims, &self.encoding_key)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoding() {
        let jot = Jot::new().unwrap();
        let token = jot.generate_token("admin").unwrap();
        println!("{}", token);

        let user_id = jot.validate_token(&token).unwrap().sub;
        assert_eq!(user_id, "admin");
    }
}
