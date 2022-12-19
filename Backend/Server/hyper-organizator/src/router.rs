use crate::authentication::login::login;
use crate::typedef::GenericError;
use crate::under_construction::default_reply;
use http::{Method, Request, Response};
use hyper::Body;

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        _ => default_reply(request).await,
    }
}
