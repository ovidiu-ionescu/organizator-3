use axum::response::Response;
use crate::app_error::AppError;
use axum::{
    http::{StatusCode, header},
    response::IntoResponse,
};

pub fn build_axum_json_response(data_result: String) -> Result<Response, AppError> {
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        data_result,
    )
        .into_response())
}



