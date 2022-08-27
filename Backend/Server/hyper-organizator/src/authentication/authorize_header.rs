use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::SystemTime;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    pub sub: String,
    pub exp: i32,
}

pub struct Jot {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
}

impl Jot {
    pub fn new() -> Result<Jot, Box<dyn Error>> {
        let rng = SystemRandom::new();
        let mut bytes = [0u8; 32];
        rng.fill(&mut bytes)?;
        let encoding_key = EncodingKey::from_secret(&bytes);
        let decoding_key = DecodingKey::from_secret(&bytes);
        Ok(Jot {
            encoding_key,
            decoding_key,
        })
    }

    pub fn generate_token(
        self: &Self,
        user_id: &str,
        validity_in_seconds: i32,
    ) -> Result<String, Box<dyn Error>> {
        let exp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)?
            .as_secs() as i32
            + validity_in_seconds;
        let claims = Claims {
            sub: user_id.to_string(),
            exp,
        };
        Ok(encode(&Header::default(), &claims, &self.encoding_key)?)
    }

    pub fn validate_token(self: &Self, token: &str) -> Result<String, Box<dyn Error>> {
        let validation = Validation::new(Algorithm::HS256);
        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)?;
        Ok(token_data.claims.sub)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoding() {
        let jot = Jot::new().unwrap();
        let token = jot.generate_token("admin", 3600).unwrap();
        println!("{}", token);

        let user_id = jot.validate_token(&token).unwrap();
        assert_eq!(user_id, "admin");
    }
}
