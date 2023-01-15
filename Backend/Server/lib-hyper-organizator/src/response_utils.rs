use http::{Request, Response};
use hyper::{Body, StatusCode};

use crate::typedef::GenericError;
use futures::StreamExt;

pub struct GenericMessage;

pub trait PolymorphicGenericMessage<T> {
    fn error() -> T;
    fn unauthorized() -> T;
    fn bad_request() -> T;
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
