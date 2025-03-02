use futures_util::stream::StreamExt;
use hyper::{Body, Request};
use log::{debug, log_enabled, trace};
use memchr::memmem;
use regex::Regex;
use std::sync::LazyLock;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

///
/// Start -> Headers -> Field -> Headers  
///                  -> File
///
#[derive(Debug)]
enum Status {
  Start,
  Headers,       // buffer
  Field(String), // delimiter, buffer
  File,          // delimiter, file
  End,               // 
}

#[derive(Debug)]
pub struct RegularField {
  pub name: String,
  pub value: String,
}

#[derive(Debug)]
pub struct FileField {
  pub upload_name: String,
  pub file_name: String,
}

#[derive(Debug)]
pub enum Field {
  Regular(RegularField),
  File(FileField),
}

// read first boundary
// read until empty line \r\n\r\n
// analyze headers
// read until boundary
pub async fn handle_multipart(
  mut req: Request<Body>, file_dir: &str,
) -> Result<Vec<Field>, hyper::Error> {
  // if we are on debug mode, dump the file to /tmp/file.bin
  let mut dump = if log_enabled!(log::Level::Debug) {
    Some(File::create("/tmp/file.bin").await.unwrap())
  } else {
    None
  };
  // Get the boundary from the content type header
  let mut result = Vec::new();
  let content_type = req.headers().get("content-type").unwrap().to_str().unwrap();
  let boundary = content_type.split("boundary=").nth(1).unwrap();
  debug!(
    "Content type: 「{}」, boundary: 「{}」",
    content_type, boundary
  );
  let boundary = format!("\r\n--{boundary}");
  let header_delimiter = b"\r\n\r\n";
  let mut buf: Vec<u8> = Vec::with_capacity(512);

  let mut file_dest = Destination::Unknown;
  let mut status = Status::Start;
  while let Some(chunk) = req.body_mut().next().await {
    let chunk = chunk.unwrap();
    if let Some(ref mut dump_file) = dump {
      dump_file.write_all(&chunk).await.unwrap();
    }
    let mut offset = 0;
    loop {
      // loop inside the chunk until we reach the end of the chunk
      debug!("Status: {:?}", status);
      match status {
        Status::Start => {
          debug!("read the first boundary");
          let res = read_to_delimiter(&chunk, &mut Destination::Buffer(&mut buf), b"\r\n", 0).await;
          offset = match res {
            ReadResult::Done(offset) => offset,
            _ => panic!("Expected Done"),
          };
          status = Status::Headers;
          buf.clear();
        },
        Status::Headers => {
          match read_to_delimiter(
            &chunk,
            &mut Destination::Buffer(&mut buf),
            header_delimiter,
            offset,
          )
          .await
          {
            ReadResult::Done(crt_offset) => {
              offset = crt_offset;
              let header = parse_headers(&buf);
              match header {
                HeaderResult::Field(field) => {
                  debug!("Field: {}", field);
                  status = Status::Field(field);
                },
                HeaderResult::File(file_name) => {
                  debug!("File: {}", file_name);
                  let random_file_name = uuid::Uuid::new_v4().to_string();
                  // get the extension from the file_name
                  let ext = file_name.split('.').last().unwrap();
                  file_dest =
                    Destination::new_file(format!("{file_dir}/{random_file_name}.{ext}")).await;
                  debug!("File destination: {:?}", file_dest);
                  status = Status::File;
                  result.push(Field::File(FileField {
                    file_name: format!("{random_file_name}.{ext}"),
                    upload_name: file_name,
                  }));
                },
                HeaderResult::Failed => {
                  panic!("Failed to parse headers");
                },
              }
              buf.clear();
            },
            ReadResult::EndOfChunk => {
              break;
            },
            _ => panic!("Expected Done"),
          }
        },
        Status::Field(ref field_name) => {
          let res = read_to_delimiter(
            &chunk,
            &mut Destination::Buffer(&mut buf),
            boundary.as_bytes(),
            offset,
          )
          .await;
          offset = match res {
            ReadResult::Done(offset) => {
              result.push(Field::Regular(RegularField {
                name: field_name.clone(),
                value: std::str::from_utf8(&buf).unwrap().to_string(),
              }));

              status = Status::Headers;
              offset
            },
            ReadResult::End => {
              result.push(Field::Regular(RegularField {
                name: field_name.clone(),
                value: std::str::from_utf8(&buf).unwrap().to_string(),
              }));
              status = Status::End;
              break;
            },
            ReadResult::EndOfChunk => {
              break;
            },
          };
        },
        Status::File => {
          debug!("Write to file");
          let res = read_to_delimiter(&chunk, &mut file_dest, boundary.as_bytes(), offset).await;
          offset = match res {
            ReadResult::Done(offset) => {
              status = Status::Headers;
              debug!("Done reading file");
              offset
            },
            ReadResult::End => {
              status = Status::End;
              break;
            },
            ReadResult::EndOfChunk => {
              break;
            },
          };
        },
        Status::End => {
          break;
        },
      }

      //file.write_all(&chunk).await.unwrap();
    }
  }

  Ok(result)
}

#[derive(Debug, PartialEq)]
enum ReadResult {
  Done(usize), // how many bytes were appended to the buffer
  EndOfChunk,
  End,
}

#[derive(Debug)]
enum Destination<'a> {
  Buffer(&'a mut Vec<u8>),
  DiskFile(File),
  Unknown,
}

impl Destination<'_> {
  async fn write(&mut self, chunk: &[u8]) {
    match self {
      Self::Buffer(buf) => buf.extend_from_slice(chunk),
      Self::DiskFile(file) => file.write_all(chunk).await.unwrap(),
      Self::Unknown => panic!("Invalid destination"),
    }
  }

  async fn new_file(file_name: String) -> Self {
    let file = File::create(file_name).await.unwrap();
    Destination::DiskFile(file)
  }
}

/// Delimiter should not be appended to the buffer or written to the file
async fn read_to_delimiter(
  chunk: &[u8], destination: &mut Destination<'_>, pattern: &[u8], offset: usize,
) -> ReadResult {
  trace!(
    "Read to delimiter, offset: {}, delimiter len: {}",
    offset,
    pattern.len()
  );
  let remaining = &chunk[offset..];

  match memmem::find(remaining, pattern) {
    Some(pos) => {
      trace!(
        "Found pattern at {}, 「{}」",
        pos,
        std::str::from_utf8(&remaining[pos..(pos + pattern.len())]).unwrap()
      );
      destination.write(&remaining[..pos]).await;
      // check if this is the end => if the delimiter starts with -- and there is -- after the
      // delimiter
      if pattern.starts_with(b"\r\n--") && remaining.len() >= pos + pattern.len() + 2 && remaining[pos + pattern.len()..].starts_with(b"--") {
        debug!("End of multipart, remaining len: {}, pos: {}, pattern len: {}", remaining.len(), pos, pattern.len());
        return ReadResult::End;
      }
      ReadResult::Done(offset + pos + pattern.len())
    },
    None => {
      destination.write(remaining).await;
      ReadResult::EndOfChunk
    },
  }
}

#[derive(Debug, PartialEq)]
enum HeaderResult {
  Field(String), // field name
  File(String),  // file name,
  Failed,
}

static RE: LazyLock<Regex> = LazyLock::new(|| {
  Regex::new(
    r#"Content-Disposition: form-data; name="(?P<field>[^"]+)"(; filename="(?P<file>[^\"]+)")?"#,
  )
  .unwrap()
});

/// The buffer contains the headers in full, they have been extracted
fn parse_headers(buf: &[u8]) -> HeaderResult {
  // we need to split the headers into lines
  let lines = buf.split(|&c| c == b'\n');
  for line in lines {
    trace!("Header line: {:?}", std::str::from_utf8(line));
    if let Some(captures) = RE.captures(std::str::from_utf8(buf).unwrap()) {
      let field = captures.name("field").unwrap().as_str();
      let file = captures.name("file").map(|m| m.as_str());
      return match file {
        Some(f) => HeaderResult::File(f.to_string()),
        None => HeaderResult::Field(field.to_string()),
      };
    }
  }

  HeaderResult::Failed
}

// tests
#[cfg(test)]
mod test1 {
  use super::*;

  const END_OF_HEADERS: &[u8] = b"\r\n\r\n";
  #[tokio::test]
  async fn test_read_headers_all() {
    let mut buf = Vec::new();
    let mut dest = Destination::Buffer(&mut buf);
    let chunk = b"Content-Type: text/plain\r\n\r\n";
    let res = read_to_delimiter(chunk, &mut dest, END_OF_HEADERS, 0).await;
    assert_eq!(res, ReadResult::Done(28));
    assert_eq!(buf, b"Content-Type: text/plain");
  }

  #[test]
  fn test_parse_headers_regular_field() {
    let headers = b"Content-Disposition: form-data; name=\"field\"\r\n\r\n";
    let res = parse_headers(headers);
    assert_eq!(res, HeaderResult::Field("field".to_string()));
  }

  #[test]
  fn test_parse_headers_file_field() {
    let headers = b"Content-Disposition: form-data; name=\"field\"; filename=\"file.txt\"\r\n\r\n";
    let res = parse_headers(headers);
    assert_eq!(res, HeaderResult::File("file.txt".to_string()));
  }

  #[tokio::test]
  async fn save_file() {
    let delimiter = b"--------------------------903c75bc8fef7ffa";
    let mut offsets = Vec::<usize>::new();
    println!("Boundary delimiter len: {}", delimiter.len());
    let header_delimited = b"\r\n\r\n";
    let multipart_unformatted = r#"-----------------------------25703068823031721183176707470
      Content-Disposition: form-data; name="memo_group_id"
      
      -1
      -----------------------------25703068823031721183176707470
      Content-Disposition: form-data; name="myFile"; filename="payload.md"
      Content-Type: text/markdown
      
      This is the payload file
      
      It has three lines
      
      -----------------------------25703068823031721183176707470
      Content-Disposition: form-data; name="end_parameter"
      
      2
      -----------------------------25703068823031721183176707470--"#;

    let multipart = multipart_unformatted.lines().map(|line| line.trim()).collect::<Vec<&str>>().join("\r\n");
    let chunk = multipart.as_bytes();
    println!("chunk: \n「{}」", std::str::from_utf8(chunk).unwrap());
    let mut _file = File::create("/tmp/file.bin").await.unwrap();
    let mut buf = Vec::new();

    println!("# read the first line, i.e. the boundary");
    let res = read_to_delimiter(chunk, &mut Destination::Buffer(&mut buf), b"\r\n", 0).await;
    println!("Res after reading boundary: {:?}", res);
    let offset = match res {
      ReadResult::Done(offset) => offset,
      _ => panic!("Expected Done"),
    };
    offsets.push(offset);
    println!("Offsets: {:?}", offsets);
    let delimiter_str = format!("\r\n{}", std::str::from_utf8(&buf).unwrap());
    let delimiter = delimiter_str.as_bytes();

    assert_eq!(res, ReadResult::Done(delimiter.len()));

    println!(
      "\n\n# read the headers for the field, Offset: {}\n「{}」",
      offset,
      std::str::from_utf8(&chunk[offset..]).unwrap()
    );
    let res = read_to_delimiter(
      chunk,
      &mut Destination::Buffer(&mut buf),
      header_delimited,
      offset,
    )
    .await;
    let offset = match res {
      ReadResult::Done(offset) => offset,
      _ => panic!("Expected Done"),
    };
    offsets.push(offset);
    println!("Offsets: {:?}", offsets);
    println!(
      "\n\n# Parse the field headers\n 「{}」",
      std::str::from_utf8(&buf).unwrap()
    );
    let field = parse_headers(&buf);
    assert_eq!(field, HeaderResult::Field("memo_group_id".to_string()));
    println!("{:?}", field);
    buf.clear();

    println!(
      "# read the field content, Offset: {}\n{}",
      offset,
      std::str::from_utf8(&chunk[offset..]).unwrap()
    );
    let res = read_to_delimiter(chunk, &mut Destination::Buffer(&mut buf), delimiter, offset).await;
    println!("Res after reading field: {:?}", res);
    let offset = match res {
      ReadResult::Done(offset) => offset,
      _ => panic!("Expected Done"),
    };
    offsets.push(offset);
    buf.clear();

    println!(
      "\n\n# read the headers for the file, Offset: {}\n「{}」",
      offset,
      std::str::from_utf8(&chunk[offset..]).unwrap()
    );
    let res = read_to_delimiter(
      chunk,
      &mut Destination::Buffer(&mut buf),
      header_delimited,
      offset,
    )
    .await;
    let offset = match res {
      ReadResult::Done(offset) => offset,
      _ => panic!("Expected Done"),
    };
    println!(
      "\n\n# Parse the file headers\n 「{}」",
      std::str::from_utf8(&buf).unwrap()
    );
    let field = parse_headers(&buf);
    assert_eq!(field, HeaderResult::File("payload.md".to_string()));

    println!(
      "\n\n# read the file content, Offset: {}\n「{}」",
      offset,
      std::str::from_utf8(&chunk[offset..]).unwrap()
    );
    let file_destination = &mut Destination::new_file("/tmp/file.bin".to_string()).await;
    let res = read_to_delimiter(chunk, file_destination, delimiter, offset).await;

    let offset = match res {
      ReadResult::Done(offset) => offset,
      _ => panic!("Expected Done"),
    };

    buf.clear();

    println!(
      "\n\n# read the headers for the field, Offset: {}\n「{}」",
      offset,
      std::str::from_utf8(&chunk[offset..]).unwrap()
    );
    let res = read_to_delimiter(
      chunk,
      &mut Destination::Buffer(&mut buf),
      header_delimited,
      offset,
    ).await;

    let offset = match res {
      ReadResult::Done(offset) => offset,
      _ => panic!("Expected Done"),
    };

    println!(
      "\n\n# Parse the field headers\n 「{}」",
      std::str::from_utf8(&buf).unwrap()
    );

    let field = parse_headers(&buf);
    assert_eq!(field, HeaderResult::Field("end_parameter".to_string()));

    println!(
      "\n\n# read the field content, Offset: {}\n{}",
      offset,
      std::str::from_utf8(&chunk[offset..]).unwrap()
    );

    let res = read_to_delimiter(chunk, &mut Destination::Buffer(&mut buf), delimiter, offset).await;

    assert_eq!(res, ReadResult::End);
  }
}
