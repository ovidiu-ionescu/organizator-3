use http::{Method, Request, Response};
use hyper::Body;
use lib_hyper_organizator::authentication::login::login;
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_reply;

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        _ => default_reply(request).await,
    }
}
