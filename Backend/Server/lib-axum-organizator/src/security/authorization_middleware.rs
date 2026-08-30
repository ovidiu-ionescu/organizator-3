use std::{sync::Arc, time::Instant};

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::response::Response;
use axum::{
    extract::{Request, State, },
    http::{HeaderName, HeaderValue, StatusCode, request::Parts},
    middleware::Next,
    Extension,
};
use tracing::error;

use crate::security::check_security::{BEARER, create_security_cookie};
use crate::security::jot::User;
use crate::{
    security::check_security::{JwtStatus, check_jwt_header, check_ssl_header},
    state::AppState,
};

pub async fn authorization_middleware(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let mut new_token = None;
    // first check the SSL headers
    if !check_ssl_header(&mut req) {
        let jot = &state.jot;
        match check_jwt_header(&mut req, jot) {
            JwtStatus::Ok => {}
            JwtStatus::Grace(token) => {
                new_token = Some(token);
            }
            JwtStatus::Expired => return Err(StatusCode::UNAUTHORIZED),
            JwtStatus::Invalid => return Err(StatusCode::UNAUTHORIZED),
            JwtStatus::NotFound => return Err(StatusCode::UNAUTHORIZED),
            JwtStatus::Error(err) => {
                error!("Error checking JWT header: {:?}", err);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }

    let start = Instant::now();
    let mut response = next.run(req).await;
    let elapsed = start.elapsed();
    let duration_ms = format!("{:.3}ms", elapsed.as_secs_f64() * 1000.0);

    if let Ok(header_val) = HeaderValue::from_str(&duration_ms) {
        response
            .headers_mut()
            .insert(HeaderName::from_static("x-response-time"), header_val);
    }
    // if the token is in the grace period, we automatically refresh it and send it back to the
    // client in the response headers and cookies
    if let Some(token) = new_token {
        let cookie = create_security_cookie(&token);

        let header = String::from(BEARER) + &token;
        response
            .headers_mut()
            .insert(header::AUTHORIZATION, header.parse().unwrap());

        response
            .headers_mut()
            .insert("Set-Cookie", cookie.parse().unwrap());
    }

    Ok(response)
}

pub struct RequireAdmin;

impl <S> FromRequestParts<S> for RequireAdmin
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
      let Extension(user) = Extension::<User>::from_request_parts(parts, _state)
            .await
            .map_err(|_| (StatusCode::UNAUTHORIZED, "Not logged in".into()))?;

        if user.is_admin() {
            Ok(RequireAdmin)
        } else {
            Err((StatusCode::FORBIDDEN, format!("User 「{}」 does not have admin privileges", user.id)))
        }
    }
}
