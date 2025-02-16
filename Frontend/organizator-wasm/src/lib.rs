mod utils;
pub mod aes;
pub mod memo;

use pulldown_cmark::{Parser, Options, html, RenderingOptions};
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

    // Set up options and parser. Strikethroughs are not part of the CommonMark standard
    // and we therefore must enable it explicitly.
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(markdown_input, options);

    // Write to String buffer.
    let mut html_output = String::new();
    let mut rendering_options = RenderingOptions::empty();
    rendering_options.insert(RenderingOptions::OPEN_LINK_IN_NEW_TAB);
    html::push_html_ext(&mut html_output, parser, rendering_options);
    html_output
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_transform_markdown() {
        assert_eq!(super::transform_markdown(r#"[my link](https://mydomain.net)"#),
        r#"<p><a target="_blank" rel="noreferrer" href="https://mydomain.net">my link</a></p>
"#);
    }
}
