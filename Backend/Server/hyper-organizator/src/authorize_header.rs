use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::error::Error;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    user_id: String,
}

fn encode_token(user_id: &str, secret: &[u8; 32]) -> String {
    let claims = Claims {
        user_id: user_id.to_string(),
    };
    let key = EncodingKey::from_secret(secret.as_ref());
    encode(&Header::default(), &claims, &key).unwrap()
}

pub fn generate_key(key: &mut [u8; 32]) -> Result<(), Box<dyn Error>> {
    let rng = SystemRandom::new();
    rng.fill(key)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encoding() {
        let mut key = [0u8; 32];
        generate_key(&mut key).unwrap();
        let token = encode_token("admin", &key);
        println!("{}", token);
    }
}
