use http::{Method, Request, Response, StatusCode};
use hyper::Body;
use lib_hyper_organizator::authentication::check_security::UserId;
use lib_hyper_organizator::authentication::jot::Jot;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::{parse_body, IntoResultHyperResponse};
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_response;
use serde::Deserialize;
use std::sync::Arc;
use tracing::{info, warn};
use utoipa::ToSchema;
use argon2::{
  password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
  },
  Argon2,
};

use crate::db::{self, fetch_login, Login};

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        (&Method::GET, "/refresh") => refresh(request).await,
        (&Method::GET, "/logout") => logout(request).await,
        (&Method::GET, "/public") => public_key(request).await,
        (&Method::POST, "/password") => update_password(request).await,

        _ => default_response(request).await,
    }
}

#[derive(Deserialize, Debug, Clone, ToSchema)]
struct LoginForm {
    username: String,
    #[schema(format = Password)]
    password: String,
}

#[utoipa::path(post, path="/login", 
    // the simple variant, commented out, will send json
    //request_body=LoginForm,
    request_body(content = LoginForm, content_type = "application/x-www-form-urlencoded"),
    responses(
        (status=200, description="Login successful", body=String),
    ),
)]
async fn login(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let form: LoginForm = parse_body(&mut request).await?;

    let client = get_connection(&request).await?;

    let login = fetch_login(&client, &form.username).await?;
    if !verify_password(&form.password, &login) {
        return "Bad password".to_text_response_with_status(StatusCode::UNAUTHORIZED);
    }

    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return "No Jot".to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let new_token: String = jot.generate_token(&form.username)?;
    info!("User 「{}」 logged in", &form.username);
    let cookie = format!("__Host-jwt={}; HttpOnly; Secure; SameSite=Strict; Path=/;", new_token);
    
    Ok(Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("content-type", "text/plain; charset=utf-8")
        .header("Set-Cookie", cookie)
        .header("server", "hyper")
        .body(Body::empty())
        //.body(Body::from(new_token))
        .unwrap())
}

pub fn verify_password(password: &str, login: &Login) -> bool {
  if let Some(password_hash_string) = &login.password_hash {
    let password_hash = PasswordHash::new(password_hash_string).unwrap();
    let ok = Argon2::default().verify_password(password.as_bytes(), &password_hash).is_ok();
    if ok {
      info!("Password for user 「{:?}」is correct", login.username);
    } else {
      warn!("Password hash found for user 「{:?}」 but password is incorrect", login.username);
    }
    ok
  } else {
    warn!("No password hash found for user 「{:?}」", login.username);
    false
  }
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
        return "User is not logged in".to_text_response_with_status(StatusCode::UNAUTHORIZED);
    };
    let requester = &user_id.0;

    let client = get_connection(&request).await?;

    // check the old password was correctly supplied
    let login = fetch_login(&client, requester).await?;
    if !verify_password(&form.old_password, &login) {
        return "Bad old password".to_text_response_with_status(StatusCode::UNAUTHORIZED);
    }

    // compute the new password hash and salt
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2.hash_password(form.new_password.as_bytes(), &salt)?.to_string();

    // use the form username if supplied and not empty, otherwise use the requester
    let username = match form.username {
        Some(ref username) if !username.is_empty() => username,
        _ => requester,
    };
    db::update_password(&client, requester, username, &password_hash).await?;
    info!("User 「{requester}」 updated password for 「{username}」");
    "Password updated".to_text_response()
}

async fn refresh(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return "No Jot".to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let Some(token) = request.headers().get("Authorization") else {
        return "No Authorization header".to_text_response_with_status(StatusCode::UNAUTHORIZED);
    };
    let token = token.to_str()?;
    let new_token = jot.refresh_token(token)?;
    new_token.to_text_response()
}

async fn logout(_request: Request<Body>) -> Result<Response<Body>, GenericError> {
    "Not implemented".to_text_response_with_status(StatusCode::NOT_IMPLEMENTED)
}

async fn public_key(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return "No Jot".to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    jot.get_public_key().to_json_response()
}

pub use swagger::swagger_json;
mod swagger {
    use super::*;
    use utoipa::OpenApi;

    #[derive(OpenApi)]
    #[openapi(
        paths(super::login,),
        components(schemas(LoginForm, ChangePasswordForm,))
    )]
    pub struct ApiDoc;

    pub fn swagger_json() -> String {
        serde_json::to_string_pretty(&ApiDoc::openapi()).unwrap()
    }
}
