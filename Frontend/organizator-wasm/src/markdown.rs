use barcoders::{
  generators::svg::SVG,
  sym::{code128::Code128, ean13::EAN13},
};
use pulldown_cmark::{CodeBlockKind, CowStr, Event, Options, Parser, Tag, TagEnd, TextMergeStream};
use pulldown_cmark_escape::{escape_href, escape_html};

#[derive(PartialEq)]
enum CustomBlocks {
  Code128,
  EAN13,
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
    Event::Start(Tag::Link { link_type: _, dest_url, title, id: _ }) => Event::Html(process_link(dest_url, title)),
    Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(ref label))) => match label.as_ref() {
      "barcode128" => {
        in_custom_block = CustomBlocks::Code128;
        Event::Text("".into())
      }
      "barcode13" => {
        in_custom_block = CustomBlocks::EAN13;
        Event::Text("".into())
      }
      _ => event,
    },
    Event::Text(text) if in_custom_block == CustomBlocks::Code128 => Event::Html(process_barcode128(text)),
    Event::Text(text) if in_custom_block == CustomBlocks::EAN13 => Event::Html(process_barcode13(text)),
    Event::End(TagEnd::CodeBlock) if CustomBlocks::None != in_custom_block => {
      in_custom_block = CustomBlocks::None;
      Event::Text("".into()) // Consume the end tag
    }
    _ => event,
  });
  let mut html_output = String::new();
  pulldown_cmark::html::push_html(&mut html_output, transformed_stream);
  ammonia::clean(&html_output)
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
  let svg_gen = SVG::new(50);
  let svg_string = svg_gen.generate(encoded).unwrap_or_else(|_| "".into());
  format!("<div style=\"width: 8cm; margin: auto; background-color: white; padding: 30px;\">{}</div><div style=\"text-align:center;\">{}</div>", svg_string, text).into()
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
