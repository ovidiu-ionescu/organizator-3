use http::{Method, Request, Response};
use hyper::Body;
use lib_hyper_organizator::authentication::check_security::UserId;
use lib_hyper_organizator::authentication::jot::Jot;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::{
    read_full_body, GenericMessage, PolymorphicGenericMessage,
};
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_reply;
use ring::{digest::SHA512_OUTPUT_LEN, pbkdf2};
use serde::Deserialize;
use std::collections::HashMap;
use std::error::Error;
use std::num::NonZeroU32;
use std::sync::Arc;
use tracing::{info, warn};
use url::form_urlencoded;

use crate::db::{self, fetch_login, Login};

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        (&Method::GET, "/refresh") => refresh(request).await,
        (&Method::GET, "/logout") => logout(request).await,
        (&Method::GET, "/public") => public_key(request).await,
        (&Method::POST, "/password") => update_password(request).await,
        _ => default_reply(request).await,
    }
}

#[derive(Deserialize, Debug, Clone)]
struct LoginForm {
    username: String,
    password: String,
}

async fn parse_body(request: &mut Request<Body>) -> Result<LoginForm, GenericError> {
    let body = read_full_body(request).await?;
    match serde_urlencoded::from_bytes::<LoginForm>(&body) {
        Ok(login_form) => Ok(login_form),
        Err(e) => {
            Err(Box::<dyn Error + Send + Sync>::from(format!("Error parsing body: {}", e)).into())
        }
    }
}

async fn login(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    /*
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
    */
    let login_form = parse_body(&mut request).await?;

    let client = get_connection(&request).await?;

    let login = fetch_login(&client, &login_form.username).await?;
    if !verify_password(&login_form.password, &login) {
        return GenericMessage::unauthorized();
    }

    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let new_token: String = jot.generate_token(&login_form.username)?;
    info!("User 「{}」 logged in", &login_form.username);

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

async fn update_password(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let body = read_full_body(&mut request).await?;
    let params = form_urlencoded::parse(&body)
        .into_owned()
        .collect::<HashMap<String, String>>();
    let Some(username) = params.get("username") else {
        warn!("No username");
        return GenericMessage::bad_request();
    };
    let Some(old_password) = params.get("old_password") else {
        warn!("No current password");
        return GenericMessage::bad_request();
    };
    let Some(new_password) = params.get("new_password") else {
        warn!("No new password");
        return GenericMessage::bad_request();
    };

    // get the current user from the request
    let Some(user_id) = request.extensions().get::<UserId>() else {
        return GenericMessage::unauthorized();
    };
    let requester = &user_id.0;

    let client = get_connection(&request).await?;

    // check the old password was correctly supplied
    let login = fetch_login(&client, requester).await?;
    if !verify_password(old_password, &login) {
        return GenericMessage::unauthorized();
    }

    let salt = ring::rand::SystemRandom::new();
    let mut salt_bytes = [0u8; SHA512_OUTPUT_LEN];
    ring::rand::SecureRandom::fill(&salt, &mut salt_bytes)?;
    let n_iter = NonZeroU32::new(100_000).unwrap();
    let mut pbkdf2_bytes = [0u8; SHA512_OUTPUT_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA512,
        n_iter,
        &salt_bytes,
        new_password.as_bytes(),
        &mut pbkdf2_bytes,
    );
    db::update_password(&client, requester, username, &salt_bytes, &pbkdf2_bytes).await?;
    info!("User 「{requester}」 updated password for 「{username}」");
    GenericMessage::text_reply("Password updated")
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

async fn logout(_request: Request<Body>) -> Result<Response<Body>, GenericError> {
    GenericMessage::not_implemented()
}

async fn public_key(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let public_key_info = jot.get_public_key();
    GenericMessage::json_response(&public_key_info)
}
