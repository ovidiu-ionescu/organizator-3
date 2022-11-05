use http::{Request, Response};
use hyper::{Body, StatusCode};

use crate::typedef::GenericError;
use futures::StreamExt;
use tracing::{debug, info};
pub struct GenericMessage;

impl GenericMessage {
    pub fn unauthorized() -> Result<Response<Body>, GenericError> {
        Self::json_message_response(StatusCode::UNAUTHORIZED, "Unauthorized")
    }

    pub fn error() -> Result<Response<Body>, GenericError> {
        Self::json_message_response(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
    }

    pub fn bad_request() -> Result<Response<Body>, GenericError> {
        Self::json_message_response(StatusCode::BAD_REQUEST, "Bad Request")
    }

    pub fn text_reply(s: &str) -> Result<Response<Body>, GenericError> {
        Ok(Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/plain")
            .header("server", "hyper")
            .body(Body::from(s.to_string()))
            .unwrap())
    }

    pub fn json_message_response(
        code: StatusCode,
        msg: &str,
    ) -> Result<Response<Body>, GenericError> {
        let response = Response::builder()
            .status(code)
            .header("content-type", "application/json")
            .header("server", "hyper")
            .body(Body::from(format!(
                r#"{{ "code": {}, "message": "{}" }}"#,
                code, msg
            )))
            .unwrap();
        Ok(response)
    }
}

pub async fn read_full_body(req: &mut Request<Body>) -> Result<Vec<u8>, GenericError> {
    let mut body = match req
        .headers()
        .get("Content-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
    {
        Some(len) => Vec::with_capacity(len),
        None => Vec::new(),
    };
    while let Some(chunk) = req.body_mut().next().await {
        body.extend_from_slice(&chunk?);
    }
    Ok(body.to_vec())
}
