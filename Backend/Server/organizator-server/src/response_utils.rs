use axum::response::Response;
use axum::{
    Json,
    response::IntoResponse,
};
use lib_axum_organizator::app_error::AppError;
use lib_axum_organizator::axum_response_utils::build_axum_json_response;
use serde_json::json;

use crate::model::{Named, Requester};

//////////////////////////////////////////////////////
/// Response utils
pub fn build_json_response<T: serde::Serialize + Named>(
    data_result: (T, Requester),
) -> Result<Response, AppError> {
    let (data, requester) = data_result;
    let result = json!({
      T::name(): data,
      "requester": requester,
    });
    Ok(Json(result).into_response())
}

pub fn build_simple_json_response(data_result: (String, Requester)) -> Result<Response, AppError> {
  build_axum_json_response(data_result.0)
}
/// The number of characters the memo title column holds.
const TITLE_LIMIT: usize = 255;

/// Split a first line so that the title part fits the column it is stored in, answering the
/// title and the rest of the line.
///
/// The rest belongs at the front of the body: a memo is read back as its title followed by its
/// body, so splitting the line this way keeps every character of what was written. A line that
/// already fits comes back whole with nothing after it.
///
/// Characters, not bytes: the column counts characters, and splitting by bytes would cut an
/// accented letter, or any letter outside ASCII, in half.
pub fn split_title_for_column(first_line: &str) -> (&str, &str) {
    match first_line.char_indices().nth(TITLE_LIMIT) {
        Some((cut, _)) => first_line.split_at(cut),
        None => (first_line, ""),
    }
}

pub fn split_and_trim(s: &str) -> (&str, &str) {
    let trimmed = s.trim_start();
    if let Some(pos) = trimmed.find('\n') {
        // ends_with on the part before the newline, rather than slicing out the byte before it:
        // that byte is inside the last character whenever that character is not ASCII — "Café" —
        // and slicing a &str anywhere but a character boundary panics, taking the request with it.
        let (first_part, _second_part) = if pos > 0 && trimmed[..pos].ends_with('\r') {
            trimmed.split_at(pos - 1)
        } else {
            trimmed.split_at(pos)
        };
        (first_part, &trimmed[pos..])
    } else {
        (trimmed, "")
    }
}

pub fn millis_since_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::{split_and_trim, split_title_for_column};

    #[test]
    fn keeps_a_long_first_line_whole_by_moving_the_rest_into_the_body() {
        let long = "é".repeat(300);
        let (title, rest) = split_title_for_column(&long);
        assert_eq!(title.chars().count(), 255);
        assert_eq!(rest.chars().count(), 45);
        // Not one character lost, and the split is on a character boundary.
        assert_eq!(format!("{title}{rest}"), long);

        let (short, rest) = split_title_for_column("Café");
        assert_eq!((short, rest), ("Café", ""));
    }

    #[test]
    fn splits_the_first_line_from_the_body() {
        assert_eq!(split_and_trim("title\nbody"), ("title", "\nbody"));
        // The carriage return goes with the title, not with the body.
        assert_eq!(split_and_trim("title\r\nbody"), ("title", "\nbody"));
        assert_eq!(split_and_trim("no newline at all"), ("no newline at all", ""));
    }

    #[test]
    fn splits_a_title_that_ends_in_a_character_that_is_not_ascii() {
        // Slicing out the byte before the newline panicked here: it is part of "é".
        assert_eq!(split_and_trim("Café\nbody"), ("Café", "\nbody"));
        assert_eq!(split_and_trim("Café\r\nbody"), ("Café", "\nbody"));
        assert_eq!(split_and_trim("Țară\nbody"), ("Țară", "\nbody"));
    }
}
