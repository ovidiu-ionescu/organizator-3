use http::{Method, Request, Response};
use hyper::Body;
use lib_hyper_organizator::authentication::check_security::UserId;
use lib_hyper_organizator::authentication::jot::Jot;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::{
    parse_body, GenericMessage, PolymorphicGenericMessage,
};
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_reply;
use ring::{digest::SHA512_OUTPUT_LEN, pbkdf2};
use serde::Deserialize;
use std::num::NonZeroU32;
use std::sync::Arc;
use tracing::info;
use utoipa::ToSchema;

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

#[derive(Deserialize, Debug, Clone, ToSchema)]
struct LoginForm {
    username: String,
    password: String,
}

async fn login(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let form: LoginForm = parse_body(&mut request).await?;

    let client = get_connection(&request).await?;

    let login = fetch_login(&client, &form.username).await?;
    if !verify_password(&form.password, &login) {
        return GenericMessage::unauthorized();
    }

    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let new_token: String = jot.generate_token(&form.username)?;
    info!("User 「{}」 logged in", &form.username);

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

#[derive(Deserialize, Debug, Clone, ToSchema)]
struct ChangePasswordForm {
    username:     Option<String>,
    old_password: String,
    new_password: String,
}

async fn update_password(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let form: ChangePasswordForm = parse_body(&mut request).await?;

    // get the current logged in user from the request
    let Some(user_id) = request.extensions().get::<UserId>() else {
        return GenericMessage::unauthorized();
    };
    let requester = &user_id.0;

    let client = get_connection(&request).await?;

    // check the old password was correctly supplied
    let login = fetch_login(&client, requester).await?;
    if !verify_password(&form.old_password, &login) {
        return GenericMessage::unauthorized();
    }

    // compute the new password hash and salt
    let salt = ring::rand::SystemRandom::new();
    let mut salt_bytes = [0u8; SHA512_OUTPUT_LEN];
    ring::rand::SecureRandom::fill(&salt, &mut salt_bytes)?;
    let n_iter = NonZeroU32::new(100_000).unwrap();
    let mut pbkdf2_bytes = [0u8; SHA512_OUTPUT_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA512,
        n_iter,
        &salt_bytes,
        form.new_password.as_bytes(),
        &mut pbkdf2_bytes,
    );

    // use the form username if supplied and not empty, otherwise use the requester
    let username = match form.username {
        Some(ref username) if !username.is_empty() => username,
        _ => requester,
    };
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
