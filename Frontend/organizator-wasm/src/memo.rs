//! Utils for processing text in the memos in Organizator.
//!
//! As Organizator allows encrypting data on the client, this library will be
//! compiled to webassembly and mostly used in the browser.
//!
//! ### Encryption
//! The parts of the text that are supposed to be encrypted will be marked with
//! Japanese quotes: `「secret」`.\
//! The encryption algorithm is AES-256 with a timestamp nonce and a counter.
//! After encryption, the text will be base64 encoded.
//!
//! ### Decryption
//! The text will be decrypted with the same algorithm and the same key. The bits
//! to be decrypted are automatically detected by looking for base64-encoded
//! sequences.
//!
//! ### Presentation
//! Because long base64-encoded strings are not very readable, those sequences
//! will be replaced with a shorter version followed by &hellip; (ellipsis).

use crate::aes::{aes_ctr_decrypt, aes_ctr_encrypt};

struct Part<'a> {
    text:  &'a str,
    clear: bool,
}

struct PartDescriptor {
    start:  usize,
    end:    usize,
    base64: bool,
}

struct Status {
    char_count:  usize,
    equal_count: usize,
    inside:      bool,
    found:       isize,
    prev_pos:    usize,
    // in the tuple the bool is true if we have a base64 value, opposite of Part.clear
    parts:       Vec<PartDescriptor>,
}

impl Status {
    fn new() -> Status {
        Status {
            char_count:  0,
            equal_count: 0,
            // wether we think we are inside a b64 string
            inside:      false,
            found:       0,
            // the last position that was included in the parts
            prev_pos:    0,
            parts:       Vec::with_capacity(10),
        }
    }

    /// Check if we have advanced to the end of a base64 segment
    fn check_base64(&mut self, pos: usize) {
        let total_chars = self.char_count + self.equal_count;
        if total_chars >= 16 && total_chars % 4 == 0 && self.inside {
            self.found += 1;
            // add the clear string if it is non empty
            if self.prev_pos < pos - total_chars {
                self.parts.push(PartDescriptor {
                    start:  self.prev_pos,
                    end:    pos - total_chars,
                    base64: false,
                });
            }
            self.parts.push(PartDescriptor {
                start:  pos - total_chars,
                end:    pos,
                base64: true,
            });
            // println!("Found a base64");
            self.prev_pos = pos;
        }
        // println!("prev_pos: {}, total_chars {}", self.prev_pos, total_chars);
        self.char_count = 0;
        self.equal_count = 0;
        self.inside = false;
    }
}

fn is_space(c: char) -> bool {
    [' ', '\t', '\n', '\r'].contains(&c)
}

fn b64here(s: &str) -> Vec<PartDescriptor> {
    let mut status = Status::new();

    let mut prev_space = true;
    for (pos, c) in s.char_indices() {
        if status.inside {
            // we can only have = signs at the end and max three of them
            if (c != '=' && status.equal_count > 0) || (c == '=' && status.equal_count > 2) {
                status.check_base64(pos);
                continue;
            }

            if c == '=' {
                status.equal_count += 1;
                continue;
            }
        }

        if ('A'..='Z').contains(&c)
            || ('a'..='z').contains(&c)
            || ('0'..='9').contains(&c)
            || '/' == c
            || '+' == c
        {
            if status.inside || prev_space {
                status.char_count += 1;
                status.inside = true;
                prev_space = false;
            }
        } else {
            if status.inside {
                status.check_base64(pos);
            }
            prev_space = is_space(c);
        }
    }
    status.check_base64(s.len());
    if status.prev_pos < s.len() {
        status.parts.push(PartDescriptor {
            start:  status.prev_pos,
            end:    s.len(),
            base64: false,
        });
    }
    status.parts
}

#[cfg(test)]
mod tests {

    #[test]
    fn b64here_test() {
        let s = r#"
This is a sample test text

First secret
8xRyXaSkpKQGqlTMpMssgnNsZDnatopg

Second secret
/xRyXY6Ojo7/u45hZut8f41Uf6C2GvNCdA==

Third secret
DhVyXUxMTEwpo9eX4aw7dJnT1zaZ9DBqISbEU0rj6pPcoWZk5m1xTDqQouV4pyOxdLLVIeBfZG/bF2Rlm4AVR7dnn28t8Sr5
Fourth secret
JhVyXYWFhYVkprM94+hLMA=="#;
        let parts = super::b64here(&s);
        parts
            .iter()
            .for_each(|p| print!("\u{300C}{}\u{300D}{} ", &s[p.start..p.end], p.base64));
        assert_eq!(parts.len(), 8);
        let encrypted_parts_count = parts.iter().filter(|p| p.base64).count();
        assert_eq!(encrypted_parts_count, 4);
        println!("The parsed parts=====================");
        parts.iter().for_each(|p| print!("{}", &s[p.start..p.end]));
    }

    #[test]
    fn b64here_test2() {
        let s = "Everything is in clear";
        let parts = super::b64here(&s);
        assert_eq!(parts.len(), 1);
        let t = parts.first().unwrap();
        assert_eq!(t.start, 0);
        assert_eq!(t.end, s.len());
    }

    #[test]
    fn b64here_test3() {
        let s = "JhVyXYWFhYVkprM94+hLMA== ";
        let parts = super::b64here(&s);
        parts
            .iter()
            .for_each(|p| print!("[{}]", &s[p.start..p.end]));
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn fake_b64() {
        let s = "http://www.positioniseverything";
        let parts = super::b64here(&s);
        parts
            .iter()
            .for_each(|p| print!("[{}]", &s[p.start..p.end]));
        println!("Above are the fake parts");
        assert_eq!(parts.len(), 1);
    }

    #[test]
    fn fake_b64_2() {
        let s = r#"# Serverless
_2020-05-08_  

[www.cs.utah.edu](https://www.cs.utah.edu/~lifeifei/papers/shredder.pdf) 

[blog.acolyer.org](https://blog.acolyer.org/2020/01/29/narrowing-the-gap/) Narrowing the gap between serverless and its state with storage functions
"#;
        let parts = super::b64here(&s);
        parts
            .iter()
            .for_each(|p| print!("\u{300C}{}\u{300D}{} ", &s[p.start..p.end], p.base64));
        assert_eq!(parts.len(), 1);
    }
}

/// Truncates the large segments of base64 and adds an ellipsis inside input string
/// (uses unsafe)
///
/// The replacement is done in place. The string is not reallocated.\
/// Because the ellipsis is 3 bytes long, the visible truncation will end up
/// being 2 characters shorter, 2 extra bytes are used by the ellipsis.
pub fn prepare_memo_for_view(memo_text: &mut str, max_size: usize) -> &str {
    let parts = b64here(memo_text);
    println!("Found {} parts", parts.len());
    let ellipsis = [0xE2, 0x80, 0xA6];

    // we store here how much we removed from the string so far
    let mut removed: usize = 0;
    parts
        .iter()
        .filter(|p| p.base64 && (p.end - p.start) > max_size)
        .for_each(|p| {
            unsafe {
                let bt = memo_text.as_bytes_mut();

                // recalculate the offsets at every iteration
                let start = p.start - removed;
                let end = p.end - removed;
                // this is how much we remove now
                let extra = end - start - max_size;

                bt[start + max_size - ellipsis.len()..start + max_size].copy_from_slice(&ellipsis);
                bt.copy_within(end.., start + max_size);
                removed += extra;
            }
        });
    &memo_text[..memo_text.len() - removed]
}

#[cfg(test)]
mod test_prepare_memo {
    #[test]
    fn memo_ellipsis_test() {
        let mut s = String::from(
            r#"
    Third secret
DhVyXUxMTEwpo9eX4aw7dJnT1zaZ9DBqISbEU0rj6pPcoWZk5m1xTDqQouV4pyOxdLLVIeBfZG/bF2Rlm4AVR7dnn28t8Sr5
aha
8xRyXaSkpKQGqlTMpMssgnNsZDnatopg
123   x"#,
        );
        let short = super::prepare_memo_for_view(&mut s, 16);
        println!("{}", short);
    }

    #[test]
    fn long_string_inside_quotes() {
        let mut s = r#"# serverless
        「
        a_very_long_string_that_is_not_base64_but_is_inside_quotes
        」  
        "#
        .to_string();
        let initial_len = s.len();
        let short = super::prepare_memo_for_view(&mut s, 16);
        println!("{}", &short);
        assert_eq!(initial_len, short.len());
    }
}

/// Truncates the large segments of base64 if they are larger than `max_b64`
/// and adds an ellipsis.
///
/// Trailing spaces are removed.
///
/// The truncated strings will have `max_b64` visible characters including the
/// ellipsis. Because the ellipsis is 3 bytes long in utf-8, the actual number
/// of bytes in the truncated segment will be `max_b64 + 2`.
///
/// ```rust
/// use indoc::indoc;
/// # use memo_rust::truncate_base64;
///
/// let mut s = String::from(indoc! {r#"
///     Third secret
///     cXVpIGRvbG9yZW0gaXBzdW0gcXVpYSBkb2xvciBzaXQgYW1ldCwgY29uc2VjdGV0dXIsIGFkaXBpc2NpIHZlbGl0
///     aha
///     8xRyXaSkpKQGqlTMpMssgnNsZDnatopg
///     123   x
/// "#});
///
/// assert_eq!(
///     indoc! {r#"
///          Third secret
///          cXVpIGRvbG9yZW0…
///          aha
///          8xRyXaSkpKQGqlT…
///          123   x"#},
///     truncate_base64(&mut s, 16)
/// );
/// ```
pub fn truncate_base64(text: &str, max_b64: usize) -> String {
    let ellipsis = "\u{2026}";
    let parts = b64here(text);

    let truncated_base64_size = |start, end| {
        if end - start > max_b64 {
            max_b64 + ellipsis.len() - 1
        } else {
            end - start
        }
    };
    // calculate the total size of the reduced string
    let short_size = parts
        .iter()
        .map(|p| {
            if p.base64 {
                truncated_base64_size(p.start, p.end)
            } else {
                p.end - p.start
            }
        })
        .sum();
    let mut result = String::with_capacity(short_size);

    parts.iter().for_each(|p| {
        if p.base64 {
            if p.end - p.start > max_b64 {
                // in utf-8 this is E2 80 A6, three bytes
                result.push_str(&text[p.start..p.start + max_b64 - 1]);
                result.push_str(ellipsis);
            } else {
                result.push_str(&text[p.start..p.end]);
            }
        } else {
            result.push_str(&text[p.start..p.end]);
        }
    });
    result
}

#[cfg(test)]
mod test_truncate_base64 {
    #[test]
    fn memo_ellipsis_test() {
        let mut s = String::from(
            r#"
    Third secret
DhVyXUxMTEwpo9eX4aw7dJnT1zaZ9DBqISbEU0rj6pPcoWZk5m1xTDqQouV4pyOxdLLVIeBfZG/bF2Rlm4AVR7dnn28t8Sr5
aha
8xRyXaSkpKQGqlTMpMssgnNsZDnatopg
123   x"#,
        );
        let short = super::truncate_base64(&mut s, 16);
        println!("{}", short);
    }
}

/// Decrypts the base64 encoded segments in a memo
pub fn memo_decrypt(encrypted_memo: &str, secret: &str) -> String {
    let parts = b64here(encrypted_memo);
    let mut result = String::with_capacity(encrypted_memo.len());
    parts
        .iter()
        .map(|p| Part {
            text:  &encrypted_memo[p.start..p.end],
            clear: !p.base64,
        })
        .for_each(|p| {
            if p.clear {
                result.push_str(p.text);
            } else {
                let clear_text = &aes_ctr_decrypt(p.text, secret);
                if clear_text.len() == p.text.len() {
                    // decryption failed, encrypted text is the same length as clear text
                    result.push_str(clear_text);
                } else {
                    result.push('\u{300c}');
                    result.push_str(clear_text);
                    result.push('\u{300d}');
                }
            }
        });
    result
}

#[cfg(test)]
mod test_memo_decryption {
    #[test]
    fn memo_decrypt_test() {
        let memo_encrypted = r#"
First secret
8xRyXaSkpKQGqlTMpMssgnNsZDnatopg

Second secret
/xRyXY6Ojo7/u45hZut8f41Uf6C2GvNCdA==
"#;
        let memo_clear = "
First secret
\u{300c}The first secret\u{300d}

Second secret
\u{300c}The second secret\u{300d}
";

        assert_eq!(memo_clear, super::memo_decrypt(memo_encrypted, "secret"));
    }

    #[test]
    fn memo_decryption_false_test() {
        let encrypted_memo = "http://www.positioniseverything";
        let clear_memo = super::memo_decrypt(encrypted_memo, "secret");
        assert_eq!(encrypted_memo, clear_memo);
    }
}

/// Encrypts all segments surrounded by Japanes quotation marks in the memo
/// `「secret」`
pub fn memo_encrypt(
    clear_memo: &str,
    secret: &str,
    initial_nonce: u64,
) -> Result<String, &'static str> {
    let opening_quote_size = "\u{300c}".len();
    let closing_quote_size = "\u{300d}".len();

    let mut nonce = initial_nonce;
    let mut result = String::with_capacity(clear_memo.len() * 2);
    let mut start = 0;
    let mut encrypt = false;

    let mut prev_char = '\n';
    let mut after_closing_quote = false;
    for (pos, c) in clear_memo.char_indices() {
        match c {
            // opening quote
            '\u{300c}' => {
                after_closing_quote = false;
                if pos > start {
                    result.push_str(&clear_memo[start..pos]);
                    // make sure the encrypted result does not touch the text before it
                    match prev_char {
                        ' ' | '\n' | '\r' | '\t' => (),
                        _ => result.push(' '),
                    }
                }
                start = pos + opening_quote_size;
                if encrypt {
                    return Err("Previous quote was not ended");
                }
                encrypt = true;
            }
            // closing quote
            '\u{300d}' => {
                after_closing_quote = true;
                if !encrypt {
                    return Err("Closing quote has no opening quote");
                }
                result.push_str(&aes_ctr_encrypt(&clear_memo[start..pos], secret, nonce));
                nonce += (2 + (pos - start) / 16) as u64;
                start = pos + closing_quote_size;
                encrypt = false;
            }
            _ => {
                // if we just added an encrypted section make sure it does not touch subsequent chars
                if after_closing_quote {
                    match c {
                        ' ' | '\n' | '\r' | '\t' => (),
                        _ => result.push(' '),
                    }
                    after_closing_quote = false;
                }
                prev_char = c
            }
        }
    }
    if start < clear_memo.len() {
        result.push_str(&clear_memo[start..]);
    }
    Ok(result)
}

#[cfg(test)]
mod test_memo_encrypt {
    #[test]
    fn memo_encrypt_test() {
        let clear_memo = "
First secret
\u{300c}The first secret\u{300d} a

Second secret
\u{300c}The second secret\u{300d}
End
";

        let encrypted_memo = "
First secret
AAAAAAAAAACmrCf4UYHplcBTiCEztS/3 a

Second secret
AwAAAAAAAADSUdXvchKudrwyi9q+mYmOUtD762Z48LL6PfIqyh+TyQ==
End
";
        match super::memo_encrypt(&clear_memo, "secret", 0) {
            Ok(s) => assert_eq!(encrypted_memo, s),
            Err(s) => println!("Failed to process memo: {}", s),
        }
    }

    #[test]
    fn memo_encrypt_spaces() {
        let clear_memo = "
First secret\u{300c}The first secret\u{300d}
Second secret
\u{300c}The second secret\u{300d}is here
";
        let encrypted_memo = "
First secret AAAAAAAAAACmrCf4UYHplcBTiCEztS/3
Second secret
AwAAAAAAAADSUdXvchKudrwyi9q+mYmOUtD762Z48LL6PfIqyh+TyQ== is here
";

        match super::memo_encrypt(&clear_memo, "secret", 0) {
            Ok(s) => assert_eq!(encrypted_memo, s),
            Err(s) => println!("Failed to process memo: {}", s),
        }
    }

    #[test]
    fn memo_encrypt_short() {
        let clear_memo = "Secret \u{300c}secret\u{300d}";
        let encrypted_memo = "Secret AAAAAAAAAACBoSGqUpyb5rRz+0RQx0qD";

        match super::memo_encrypt(&clear_memo, "secret", 0) {
            Ok(s) => assert_eq!(encrypted_memo, s),
            Err(s) => println!("Failed to process memo: {}", s),
        }
    }
}
