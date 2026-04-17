use std::collections::HashSet;

use ammonia::Builder;
use barcoders::{
    sym::{code128::Code128, ean13::EAN13},
};
use pulldown_cmark::{CodeBlockKind, CowStr, Event, Options, Parser, Tag, TagEnd, TextMergeStream};
use pulldown_cmark_escape::{escape_href, escape_html};

#[derive(PartialEq)]
enum CustomBlocks {
    Code128,
    EAN13,
    Code128SVG,
    EAN13SVG,
    None,
}

pub fn process_markdown(markdown: &str) -> String {
    // Set up options and parser. Strikethroughs are not part of the CommonMark standard
    // and we therefore must enable it explicitly.
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = TextMergeStream::new(Parser::new_ext(markdown, options));
    let mut in_custom_block = CustomBlocks::None;
    let transformed_stream = parser.map(|event| match event {
        Event::Start(Tag::Link {
            link_type: _,
            dest_url,
            title,
            id: _,
        }) => Event::Html(process_link(dest_url, title)),
        Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(ref label))) => match label.as_ref() {
            "barcode128" => {
                in_custom_block = CustomBlocks::Code128;
                Event::Text("".into())
            }
            "barcode13" => {
                in_custom_block = CustomBlocks::EAN13;
                Event::Text("".into())
            }
            "barcode128svg" => {
                in_custom_block = CustomBlocks::Code128SVG;
                Event::Text("".into())
            }
            "barcode13svg" => {
                in_custom_block = CustomBlocks::EAN13SVG;
                Event::Text("".into())
            }
            _ => event,
        },
        Event::Text(text) if in_custom_block == CustomBlocks::Code128 => {
            //Event::Html(process_barcode128(text))
            Event::Html(process_barcode128_libre(text))
        }
        Event::Text(text) if in_custom_block == CustomBlocks::EAN13 => {
            //Event::Html(process_barcode13(text))
            Event::Html(process_barcode13_libre(text))
        }
        Event::Text(text) if in_custom_block == CustomBlocks::Code128SVG => {
            Event::Html(process_barcode128(text))
        }
        Event::Text(text) if in_custom_block == CustomBlocks::EAN13SVG => {
            Event::Html(process_barcode13(text))
        }
        Event::End(TagEnd::CodeBlock) if CustomBlocks::None != in_custom_block => {
            in_custom_block = CustomBlocks::None;
            Event::Text("".into()) // Consume the end tag
        }
        _ => event,
    });
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, transformed_stream);
    ammonia_clean(&html_output)
}

fn process_link<'a>(dest_url: CowStr, title: CowStr) -> CowStr<'a> {
    let mut result = String::with_capacity(512);
    result.push_str("<a href=\"");
    if escape_href(&mut result, &dest_url).is_err() {
        return "".into();
    }
    result.push_str("\" target=\"_blank\" rel=\"noreferrer");
    if !title.is_empty() {
        result.push_str("\" title=\"");
        if escape_html(&mut result, &title).is_err() {
            return "".into();
        }
    }
    result.push_str("\">");
    result.into()
}

fn barcode2svg<'a>(encoded: &[u8], text: CowStr) -> CowStr<'a> {
    let svg_gen = crate::barcode_svg::SVG::new(50);
    
    svg_gen.generate(encoded, text).unwrap_or_else(|_| "".into()).into()
}

fn process_barcode128<'a>(text: CowStr) -> CowStr<'a> {
    match Code128::new(format!("{}{}", "\u{00C0}", text.trim())) {
        Ok(barcode) => {
            let encoded = barcode.encode();
            barcode2svg(&encoded, text)
        }
        Err(_) => "<p style='color:red;'>Invalid Barcode Data</p>".into(),
    }
}

fn process_barcode13(text: CowStr) -> CowStr {
    match EAN13::new(text.trim()) {
        Ok(barcode) => {
            let encoded = barcode.encode();
            barcode2svg(&encoded, text)
        }
        Err(_) => "<p style='color:red;'>Invalid Barcode Data</p>".into(),
    }
}

fn process_barcode13_libre(text: CowStr) -> CowStr {
    format!(r#"<div data-gen="barcode13"><span>{}</span></div>"#, text).into()
}

fn process_barcode128_libre(text: CowStr) -> CowStr {
    let encoded = encode_libre_barcode_128(&text.trim());
    format!(r#"<div data-gen="barcode128"><span>{}</span></div>"#, encoded).into()
}

fn encode_libre_barcode_128(data: &str) -> String {
    let mut encoded = String::new();
    
    // 1. Start Character for Subset B is ASCII 204 (Ì)
    let start_char = 'Ì';
    encoded.push(start_char);

    let mut checksum: usize = 104; // Start value for Subset B

    for (i, c) in data.chars().enumerate() {
        let val = c as usize - 32;
        checksum += val * (i + 1);
        encoded.push(c);
    }

    // 2. Calculate Checksum Character
    let check_digit = (checksum % 103) as u8;
    
    // Map the check digit to the correct Libre Barcode character
    let check_char = match check_digit {
        0..=94 => (check_digit + 32) as char,
        _ => (check_digit + 100) as char, // Handles special shifts/stops
    };
    encoded.push(check_char);

    // 3. Stop Character is ASCII 206 (Î)
    encoded.push('Î');

    encoded
}

fn ammonia_clean(html: &str) -> String {
    let mut cleaner = Builder::default();

    // 1. Tags: Include containers and shapes
    let svg_tags: HashSet<&str> = [
        "svg",
        "g",
        "defs",
        "linearGradient",
        "stop",
        "circle",
        "ellipse",
        "line",
        "path",
        "polygon",
        "polyline",
        "rect",
        "symbol",
        "use",
    ]
    .iter()
    .cloned()
    .collect();

    // 2. Attributes: Include presentation and coordinates
    let svg_attrs: HashSet<&str> = [
        "viewBox",
        "xmlns",
        "d",
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-opacity",
        "cx",
        "cy",
        "r",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "width",
        "height",
        "transform",
        "points",
        "offset",
        "stop-color",
        "style",
    ]
    .iter()
    .cloned()
    .collect();

    cleaner
        .add_tags(svg_tags)
        .add_generic_attributes(svg_attrs)
        // Explicitly allow the 'id' attribute only on SVGs if you want to allow
        // internal referencing (e.g., gradients) - but be careful with ID collisions!
        .add_tag_attributes("g", &["id"])
        .add_tag_attributes("linearGradient", &["id"])
        .add_tag_attributes("path", &["id"])
        .add_tag_attributes("div", &["data-gen"]);
    cleaner.clean(html).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_markdown() {
        let markdown = r#"# Diabet

_2026-04-15_  

```
aha
```

```barcode128
ZD196821562
```
[microsoft](https://microsoft.com "aha")

_2024-01-17_  
Ochi [file](/files/72788a8d-1c70-462b-90b9-5d9527c0f4c6.pdf)

_2020-01-31T08:39:35+01:00_  
---
# Diabet

Dietist Wendy van Doorn\
info@annemariedietist.nl\
0620389055
    "#;
        let html = process_markdown(markdown);
        println!("{}", html);
        assert!(html.contains("<h1>Diabet</h1>"));
        assert!(html.contains("svg"));
    }
}
