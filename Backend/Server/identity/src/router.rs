use deadpool_postgres::Pool;
use http::{Method, Request, Response};
use hyper::Body;
use lib_hyper_organizator::authentication::jot::Jot;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::{
    read_full_body, GenericMessage, PolymorphicGenericMessage,
};
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_reply;
use ring::pbkdf2;
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::Arc;
use tracing::{info, warn};
use url::form_urlencoded;

use crate::db::{fetch_login, Login};

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let pool = request
        .extensions()
        .get::<Pool>()
        .ok_or(GenericError::from("No database connection pool"))?;
    // let a_boxed_error = Box::<dyn Error + Send + Sync>::from(a_str_error);
    let connection = get_connection(&request).await?;
    let stmt = connection
        .prepare("SELECT username FROM users WHERE id = $1")
        .await?;
    let i: i32 = 1;
    let rows = connection.query(&stmt, &[&i]).await?;
    let v: &str = rows[0].get(0);
    info!("rows: {:?}, username: {}", rows, v);
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        (&Method::GET, "/refresh") => refresh(request).await,
        (&Method::GET, "/logout") => logout(request).await,
        (&Method::GET, "/public") => public_key(request).await,
        _ => default_reply(request).await,
    }
}

async fn login(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let body = read_full_body(&mut request).await?;
    let params = form_urlencoded::parse(&body)
        .into_owned()
        .collect::<HashMap<String, String>>();
    let Some(username) = params.get("username") else {
        warn!("No username");
        return GenericMessage::bad_request();
    };
    let Some(password) = params.get("password") else {
        warn!("No password");
        return GenericMessage::bad_request();
    };

    let client = get_connection(&request).await?;

    let login = fetch_login(client, username).await?;
    if !verify_password(password, &login) {
        return GenericMessage::unauthorized();
    }

    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let new_token: String = jot.generate_token(username)?;
    info!("User 「{}」 logged in", &username);

    GenericMessage::text_reply(&new_token)
}

pub fn verify_password(password: &str, login: &Login) -> bool {
    let n_iter = NonZeroU32::new(100_000).unwrap();

    let should_succeed = pbkdf2::verify(
        pbkdf2::PBKDF2_HMAC_SHA512,
        n_iter,
        &login.salt,
        password.as_bytes(),
        &login.pbkdf2,
    );

    should_succeed.is_ok()
}

async fn refresh(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let Some(token) = request.headers().get("Authorization") else {
        return GenericMessage::unauthorized();
    };
    let token = token.to_str()?;
    let new_token = jot.refresh_token(token)?;
    GenericMessage::text_reply(&new_token)
}

async fn logout(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let Some(token) = request.headers().get("Authorization") else {
        return GenericMessage::unauthorized();
    };
    let token = token.to_str()?;
    //jot.invalidate_token(token)?;
    GenericMessage::text_reply("Logged out")
}

async fn public_key(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let public_key = jot.get_public_key();
    GenericMessage::text_reply(&public_key)
}
