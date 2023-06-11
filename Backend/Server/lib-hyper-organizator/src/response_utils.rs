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

fn make_response<S>(code: StatusCode, content_type: ContentType, s: S) -> Response<Body>
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
    fn to_json_response_with_status(self, code: StatusCode) -> Response<Body>;
    fn to_json_response(self) -> Response<Body>;

    fn to_text_response_with_status(self, code: StatusCode) -> Response<Body>;
    fn to_text_response(self) -> Response<Body>;
}

impl<S> IntoHyperResponse for S
where
    Body: From<S>,
{
    fn to_json_response_with_status(self, code: StatusCode) -> Response<Body> {
        make_response(code, ContentType::Json, self)
    }

    fn to_json_response(self) -> Response<Body> {
        make_response(StatusCode::OK, ContentType::Json, self)
    }

    fn to_text_response_with_status(self, code: StatusCode) -> Response<Body> {
        make_response(code, ContentType::Text, self)
    }

    fn to_text_response(self) -> Response<Body> {
        make_response(StatusCode::OK, ContentType::Text, self)
    }
}

pub trait IntoResultHyperResponse {
    fn to_json_response_with_status(self, code: StatusCode)
        -> Result<Response<Body>, GenericError>;
    fn to_json_response(self) -> Result<Response<Body>, GenericError>;

    fn to_text_response_with_status(self, code: StatusCode)
        -> Result<Response<Body>, GenericError>;
    fn to_text_response(self) -> Result<Response<Body>, GenericError>;
}

impl<S> IntoResultHyperResponse for S
where
    Body: From<S>,
{
    fn to_json_response_with_status(
        self,
        code: StatusCode,
    ) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::to_json_response_with_status(
            self, code,
        ))
    }

    fn to_json_response(self) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::to_json_response(self))
    }

    fn to_text_response_with_status(
        self,
        code: StatusCode,
    ) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::to_text_response_with_status(
            self, code,
        ))
    }

    fn to_text_response(self) -> Result<Response<Body>, GenericError> {
        Ok(<Self as IntoHyperResponse>::to_text_response(self))
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
