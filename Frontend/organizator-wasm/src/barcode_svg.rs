//! Functionality for generating SVG representations of barcodes.
//!
//! An SVG can be constructed via the standard constructor pattern
//! or via a constructor method if you want default values.
//!
//! For example:
//!
//! ```rust
//! use barcoders::generators::svg::*;
//!
//! // Specify your own struct fields.
//! let svg = SVG{height: 80,
//!               xdim: 1,
//!               background: Color{rgba: [255, 0, 0, 255]},
//!               foreground: Color::black(),
//!               xmlns: Some(String::from("http://www.w3.org/2000/svg"))};
//!
//! // Or use the constructor for defaults (you must specify the height).
//! let svg = SVG::new(100)
//!               .xdim(2)
//!               .background(Color::white())
//!               .foreground(Color::black())
//!               .xmlns(String::from("http://www.w3.org/2000/svg"));
//! ```

use barcoders::error::Result;
use pulldown_cmark::CowStr;
/*
#[cfg(not(feature = "std"))]
use alloc::{
    format,
    string::{String, ToString},
};
*/

trait ToHex {
    fn to_hex(self) -> String;

    fn format_hex(n: u8) -> String {
        format!(
            "{}{}",
            Self::to_hex_digit(n / 16),
            Self::to_hex_digit(n % 16)
        )
    }

    fn to_hex_digit(n: u8) -> char {
        match n {
            d if d < 10 => (d + 48) as char,
            d if d < 16 => (d + 87) as char,
            _ => '0',
        }
    }
}

/// Represents a RGBA color for the barcode foreground and background.
#[derive(Copy, Clone, Debug)]
pub struct Color {
    /// Reg, Green, Blue, Alpha value.
    pub rgba: [u8; 4],
}

impl Color {
    /// Constructor.
    pub fn new(rgba: [u8; 4]) -> Color {
        Color { rgba }
    }

    /// Constructor for black (#000000).
    pub fn black() -> Color {
        Color::new([0, 0, 0, 255])
    }

    /// Constructor for white (#FFFFFF).
    pub fn white() -> Color {
        Color::new([255, 255, 255, 255])
    }

    fn to_opacity(self) -> String {
        format!("{:.*}", 2, (self.rgba[3] as f64 / 255.0))
    }
}

impl ToHex for Color {
    fn to_hex(self) -> String {
        self.rgba
            .iter()
            .take(3)
            .map(|&c| Self::format_hex(c))
            .collect()
    }
}

/// The SVG barcode generator type.
#[derive(Clone, Debug)]
pub struct SVG {
    /// The height of the barcode (```self.height``` pixels high for SVG).
    pub height: u32,
    /// The X dimension. Specifies the width of the "narrow" bars.
    /// For SVG, each will be ```self.xdim``` pixels wide.
    pub xdim: u32,
    /// The RGBA color for the foreground.
    pub foreground: Color,
    /// The RGBA color for the foreground.
    pub background: Color,
    /// The XML namespace
    pub xmlns: Option<String> 
}

impl SVG {
    /// Returns a new SVG with default values.
    pub fn new(height: u32) -> SVG {
        SVG {
            height,
            xdim: 1,
            foreground: Color {
                rgba: [0, 0, 0, 255],
            },
            background: Color {
                rgba: [255, 255, 255, 255],
            },
            xmlns: None 
        }
    }

    /// Set the xml namespace (xmlns) of the SVG
    pub fn xmlns(mut self, xmlns_uri: String) -> Self {
        self.xmlns = Some(xmlns_uri);
        self
    }

    /// Set the x dimensional bar width
    pub fn xdim(mut self, xdim: u32) -> Self {
        self.xdim = xdim;
        self
    }

    /// Set the foreground (bar) color
    pub fn foreground(mut self, color: Color) -> Self {
        self.foreground = color;
        self
    }

    /// Set the background color
    pub fn background(mut self, color: Color) -> Self {
        self.background= color;
        self
    }

    fn rect(&self, style: u8, offset: u32, width: u32) -> String {
        let fill = match style {
            1 => self.foreground,
            _ => self.background,
        };

        let opacity = match &fill.to_opacity()[..] {
            "1.00" | "1" => "".to_string(),
            o => format!(" fill-opacity=\"{}\" ", o),
        };

        format!(
            "<rect x=\"{}\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"#{}\"{}/>",
            offset,
            width,
            self.height,
            fill.to_hex(),
            opacity
        )
    }

    /// Generates the given barcode. Returns a `Result<String, Error>` of the SVG data or an
    /// error message.
    pub fn generate<T: AsRef<[u8]>>(&self, barcode: T, text: CowStr) -> Result<String> {
        let barcode = barcode.as_ref();
        let width = (barcode.len() as u32) * self.xdim;
        let rects: String = barcode
            .iter()
            .enumerate()
            .filter(|&(_, &n)| n == 1)
            .map(|(i, &n)| self.rect(n, i as u32 * self.xdim, self.xdim))
            .collect();

        let xmlns = match &self.xmlns {
            Some(xmlns) => format!("xmlns=\"{xmlns}\" "),
            None => "".to_string() 
        };

        Ok(format!(
r#"<div data-gen="barcode">
<svg version="1.1" {x}viewBox="0 0 {w} {h}" style="width: {screen_width}px; border: 30px solid white; shape-rendering: crispEdges;">{s}{r}</svg>
</div><div data-gen="barcode-text">{text}</div>
"#,
            x = xmlns,
            w = width,
            h = self.height,
            s = self.rect(0, 0, width),
            r = rects,
            screen_width = width * 2
        ))
    }
}

