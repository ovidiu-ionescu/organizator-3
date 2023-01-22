use http::{Request, Response};
use hyper::{Body, StatusCode};
use serde::Deserialize;
use std::error::Error;

use crate::typedef::GenericError;
use futures::StreamExt;

pub struct GenericMessage;

pub trait PolymorphicGenericMessage<T> {
    fn error() -> T;
    fn unauthorized() -> T;
    fn bad_request() -> T;
    fn json_response(text: &str) -> T;
    fn not_implemented() -> T;
}

impl GenericMessage {
    pub fn text_reply(s: &str) -> Result<Response<Body>, GenericError> {
        Ok(Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/plain")
            .header("server", "hyper")
            .body(Body::from(s.to_string()))
            .unwrap())
    }

    pub fn json_message_response(code: StatusCode, msg: &str) -> Response<Body> {
        Response::builder()
            .status(code)
            .header("content-type", "application/json")
            .header("server", "hyper")
            .body(Body::from(format!(
                r#"{{ "code": {code}, "message": "{msg}" }}"#
            )))
            .unwrap()
    }

    pub fn json_reply(body: &str) -> Response<Body> {
        Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "application/json")
            .header("server", "hyper")
            .body(Body::from(body.to_string()))
            .unwrap()
    }
}

impl PolymorphicGenericMessage<Response<Body>> for GenericMessage {
    fn unauthorized() -> Response<Body> {
        Self::json_message_response(StatusCode::UNAUTHORIZED, "Unauthorized")
    }

    fn error() -> Response<Body> {
        Self::json_message_response(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
    }

    fn bad_request() -> Response<Body> {
        Self::json_message_response(StatusCode::BAD_REQUEST, "Bad Request")
    }

    fn json_response(body: &str) -> Response<Body> {
        Self::json_reply(body)
    }

    fn not_implemented() -> Response<Body> {
        Self::json_message_response(StatusCode::NOT_IMPLEMENTED, "Not Implemented")
    }
}

impl PolymorphicGenericMessage<Result<Response<Body>, GenericError>> for GenericMessage {
    fn error() -> Result<Response<Body>, GenericError> {
        let e: Response<Body> = Self::error();
        Ok(e)
    }

    fn bad_request() -> Result<Response<Body>, GenericError> {
        Ok(Self::bad_request())
    }

    fn unauthorized() -> Result<Response<Body>, GenericError> {
        Ok(Self::unauthorized())
    }

    fn json_response(body: &str) -> Result<Response<Body>, GenericError> {
        Ok(Self::json_response(body))
    }

    fn not_implemented() -> Result<Response<Body>, GenericError> {
        Ok(Self::not_implemented())
    }
}

pub async fn read_full_body(req: &mut Request<Body>) -> Result<Vec<u8>, GenericError> {
    // FIXME: prevent a DoS attack by limiting the size of the body
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

pub async fn parse_body<T: for<'a> Deserialize<'a>>(
    request: &mut Request<Body>,
) -> Result<T, GenericError> {
    let body = read_full_body(request).await?;
    match serde_urlencoded::from_bytes::<T>(&body) {
        Ok(login_form) => Ok(login_form),
        Err(e) => {
            Err(Box::<dyn Error + Send + Sync>::from(format!("Error parsing body: {}", e)).into())
        }
    }
}
