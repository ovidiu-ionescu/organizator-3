mod utils;
mod markdown;
pub mod aes;
pub mod memo;

use aes::{aes_ctr_encrypt, aes_ctr_decrypt};

use wasm_bindgen::prelude::*;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello, concatenate!");
}

#[wasm_bindgen]
pub fn concatenate(s1: &str, s2: String) -> String {
    let mut s = String::with_capacity(s1.len() + s2.len());
    s.push_str(s1);
    s.push_str(&s2);
    s
}

#[wasm_bindgen]
pub fn encrypt(text: &str, password: &str, nonce: f64) -> String {
    utils::set_panic_hook();
    aes_ctr_encrypt(text, password, nonce as u64)
}

#[wasm_bindgen]
pub fn decrypt(text: &str, password: &str) -> String {
    aes_ctr_decrypt(text, password)
}

#[wasm_bindgen]
pub fn memo_decrypt(text: &str, password: &str) -> String {
    memo::memo_decrypt(text, password)
}

#[wasm_bindgen]
pub fn memo_encrypt(text: &str, password: &str, nonce: f64) -> String {
    match memo::memo_encrypt(text, password, nonce as u64) {
        Ok(s) => s,
        Err(s) => String::from(s),
    }
}

#[wasm_bindgen]
pub fn truncate_base64(text: &str, base_64_limit: usize) -> String {
    memo::truncate_base64(text, base_64_limit)
}

#[wasm_bindgen]
pub fn process_markdown(markdown_input: &str, base_64_limit: usize) -> String {
    if base_64_limit < 1 {
        transform_markdown(markdown_input)
    } else {
        transform_markdown(&memo::truncate_base64(markdown_input, base_64_limit))
    }
}

#[wasm_bindgen]
pub fn transform_markdown(markdown_input: &str) -> String {
  markdown::process_markdown(markdown_input)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_transform_markdown() {
        assert_eq!(super::transform_markdown(r#"[my link](https://mydomain.net)"#),
        r#"<p><a href="https://mydomain.net" target="_blank" rel="noreferrer">my link</a></p>
"#);
    }
}
