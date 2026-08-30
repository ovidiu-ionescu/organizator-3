use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use std::error::Error as StdError;
use tokio_postgres::Error as PgError;

use crate::postgres::handle_pg_error_response;

#[derive(Debug)]
pub enum AppError {
    Internal(Box<dyn StdError>),
    BadRequest(String),
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        AppError::BadRequest(msg.into())
    }
}

// 2. Tell Axum how to turn AppError into an HTTP response
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, public_message) = match self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.to_string()),
            AppError::Internal(err) => {
                // Log the actual error internally for debugging
                tracing::error!("Internal server error: {:?}", err);
                if let Some(pg_error) = err.downcast_ref::<PgError>() {
                    return handle_pg_error_response(pg_error).into_response();
                }

                // Return a generic 500 to the client
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our end.".into(),
                )
            }
        };

        (status, Json(json!({"error": public_message}))).into_response()
    }
}

// 3. Implement From so `?` automatically converts any error into AppError
impl<E> From<E> for AppError
where
    Box<dyn StdError + Send + Sync + 'static>: From<E>,
{
    fn from(err: E) -> Self {
        Self::Internal(Box::from(err))
    }
}
