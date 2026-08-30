use axum::response::Response;
use axum::{
    Json,
    http::{StatusCode, header},
    response::IntoResponse,
};
use lib_axum_organizator::app_error::AppError;
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
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        data_result.0,
    )
        .into_response())
}

pub fn split_and_trim(s: &str) -> (&str, &str) {
    let trimmed = s.trim_start();
    if let Some(pos) = trimmed.find('\n') {
        let (first_part, _second_part) = if pos > 0 && &trimmed[pos - 1..pos] == "\r" {
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
