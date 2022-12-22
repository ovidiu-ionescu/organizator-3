use deadpool_postgres::Pool;
use http::{Method, Request, Response};
use hyper::Body;
use lib_hyper_organizator::authentication::login::login;
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_reply;
use tracing::info;

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let pool = request
        .extensions()
        .get::<Pool>()
        .ok_or(GenericError::from("No database connection pool"))?;
    // let a_boxed_error = Box::<dyn Error + Send + Sync>::from(a_str_error);
    let connection = pool.get().await?;
    info!("Got connection from pool");
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        _ => default_reply(request).await,
    }
}
