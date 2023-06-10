use http::{HeaderValue, Request, Response};
use hyper::{Body, StatusCode};
use serde::Deserialize;
use std::error::Error;

use crate::typedef::GenericError;
use futures::StreamExt;

/// Utils to let something anything that can turn into a body to be used as a Response
enum ContentType {
    Json,
    Text,
}

fn make_reply<S>(code: StatusCode, content_type: ContentType, s: S) -> Response<Body>
where
    Body: From<S>,
{
    Response::builder()
        .status(code)
        .header(
            "content-type",
            match content_type {
                ContentType::Json => "application/json; charset=utf-8",
                ContentType::Text => "text/plain; charset=utf-8",
            },
        )
        .header("server", "hyper")
        .body(Body::from(s))
        .unwrap()
}

fn moved_permanently<V>(location: V) -> Response<Body>
where
    HeaderValue: TryFrom<V>,
    <HeaderValue as TryFrom<V>>::Error: Into<http::Error>,
{
    Response::builder()
        .status(StatusCode::MOVED_PERMANENTLY)
        .header("Location", location)
        .body(Body::empty())
        .unwrap()
}

pub trait IntoHyperResponse {
    fn json_reply_with_code(self, code: StatusCode) -> Response<Body>;
    fn json_reply(self) -> Response<Body>;

    fn text_reply_with_code(self, code: StatusCode) -> Response<Body>;
    fn text_reply(self) -> Response<Body>;
}

impl<S> IntoHyperResponse for S
where
    Body: From<S>,
{
    fn json_reply_with_code(self, code: StatusCode) -> Response<Body> {
        make_reply(code, ContentType::Json, self)
    }

    fn json_reply(self) -> Response<Body> {
        make_reply(StatusCode::OK, ContentType::Json, self)
    }

    fn text_reply_with_code(self, code: StatusCode) -> Response<Body> {
        make_reply(code, ContentType::Text, self)
    }

    fn text_reply(self) -> Response<Body> {
        make_reply(StatusCode::OK, ContentType::Text, self)
    }
}

pub trait IntoResultHyperResponse {
    fn json_reply_with_code(self, code: StatusCode) -> Result<Response<Body>, GenericError>;
    fn json_reply(self) -> Result<Response<Body>, GenericError>;

    fn text_reply_with_code(self, code: StatusCode) -> Result<Response<Body>, GenericError>;
    fn text_reply(self) -> Result<Response<Body>, GenericError>;
}

impl<S> IntoResultHyperResponse for S
where
    Body: From<S>,
{
    fn json_reply_with_code(self, code: StatusCode) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::json_reply_with_code(
            self, code,
        ))
    }

    fn json_reply(self) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::json_reply(self))
    }

    fn text_reply_with_code(self, code: StatusCode) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::text_reply_with_code(
            self, code,
        ))
    }

    fn text_reply(self) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::text_reply(self))
    }
}

pub trait IntoPermanentlyMovedResultHyperResponse {
    fn moved_permanently(self) -> Result<Response<Body>, GenericError>;
}

impl<V> IntoPermanentlyMovedResultHyperResponse for V
where
    HeaderValue: TryFrom<V>,
    <HeaderValue as TryFrom<V>>::Error: Into<http::Error>,
{
    fn moved_permanently(self) -> Result<Response<Body>, GenericError> {
        Ok(moved_permanently(self))
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
    // get the request content type
    match request
        .headers()
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
    {
        Some("application/json") => match serde_json::from_slice::<T>(&body) {
            Ok(form) => Ok(form),
            Err(e) => Err(Box::<dyn Error + Send + Sync>::from(format!(
                "Error parsing body: {e}"
            ))),
        },
        _ => match serde_urlencoded::from_bytes::<T>(&body) {
            Ok(form) => Ok(form),
            Err(e) => Err(Box::<dyn Error + Send + Sync>::from(format!(
                "Error parsing body: {e}"
            ))),
        },
    }
}
