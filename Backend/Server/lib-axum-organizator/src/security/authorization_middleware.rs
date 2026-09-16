use std::{sync::Arc, time::Instant};

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::response::Response;
use axum::{
    Extension,
    extract::{Request, State},
    http::{HeaderName, HeaderValue, StatusCode, request::Parts},
    middleware::Next,
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

impl<S> FromRequestParts<S> for RequireAdmin
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
            Err((
                StatusCode::FORBIDDEN,
                format!("User 「{}」 does not have admin privileges", user.id),
            ))
        }
    }
}

#[cfg(test)]
mod tests {

    use crate::security::check_security::{SSL_HEADER_DN, SSL_HEADER_VERIFY};
    use crate::security::jot::Jot;
    use crate::security::security_settings::SecurityConfig;
    use crate::settings::Settings;
    use crate::typedef::GenericError;

    use super::*;
    use crate::postgres::test_utils::make_dead_pool;
    use axum::body::Body;
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::{Router, middleware};
    use tower::ServiceExt;

    async fn protected_handler(Extension(user): Extension<User>) -> impl IntoResponse {
        format!("Hello {}, role: {:?}", user.id(), user.roles)
    }

    fn make_app(state: Arc<AppState>) -> Router {
        Router::new()
            .route("/protected", get(protected_handler))
            .layer(middleware::from_fn_with_state(
                state.clone(),
                authorization_middleware,
            ))
            .with_state(state)
    }

    fn make_dummy_state() -> AppState {
        // make a jot
        let security_config = SecurityConfig::default();
        let jot = Jot::autogenerate(&security_config).unwrap();
        AppState {
            settings: Settings::default(),
            pool: make_dead_pool(),
            jot,
        }
    }

    #[tokio::test]
    async fn test_authorization_middleware_with_router() {
        let state = make_dummy_state();
        let app = make_app(Arc::new(state));
        let request = Request::builder()
            .uri("/protected")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(StatusCode::UNAUTHORIZED, response.status());
    }

    // Test using the header set by Nginx from a client certificate
    #[tokio::test]
    async fn integration_test() -> Result<(), GenericError> {
        let state = Arc::new(make_dummy_state());
        let app = make_app(state.clone());

        // request with the header should be authorized
        let request = Request::builder()
            .uri("/protected")
            .header(SSL_HEADER_VERIFY, "SUCCESS")
            .header(SSL_HEADER_DN, "CN=admin")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        println!("Response: {:#?}", &response);
        assert_eq!(response.status(), StatusCode::OK);

        // request without the header should be unauthorized
        let app = make_app(state.clone());
        let request = Request::new(Body::empty());
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        Ok(())
    }

    macro_rules! test_with_env {
        ($expiry: expr, $grace: expr, $response: ident) => {
            let security_config = SecurityConfig {
                session_expiry: $expiry,
                session_expiry_grace_period: $grace,
                public_key_url: None,
            };
            let mut jot = Jot::autogenerate(&security_config).unwrap();
            jot.session_expiry = $expiry;
            jot.session_expiry_grace_period = $grace;
            let token = jot.generate_token("admin", &[]).unwrap();

            let state = Arc::new(AppState {
                settings: Settings::default(),
                pool: make_dead_pool(),
                jot,
            });
            let app = make_app(state.clone());
            let header = String::from(BEARER) + &token;

            // request with a valid JWT token should be authorized
            let request = Request::builder()
                .uri("/protected")
                .header(header::AUTHORIZATION, header)
                .body(Body::empty())
                .unwrap();

            let $response = app.oneshot(request).await.unwrap();
        };
    }

    // Test using the Authorization header with a JWT token
    #[tokio::test]
    async fn integration_test_jwt() -> Result<(), GenericError> {
        test_with_env!(3600, 300, response);
        assert_eq!(response.status(), StatusCode::OK);

        // request with a header in the grace period should be authorized
        test_with_env!(0, 300, response);
        assert_eq!(response.status(), StatusCode::OK);

        // check we got a new token

        // request with an expired JWT token should be unauthorized
        test_with_env!(0, 0, response);
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        Ok(())
    }
}
