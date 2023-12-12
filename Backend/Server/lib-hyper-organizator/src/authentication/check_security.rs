use crate::authentication::jot::{ExpiredToken, Jot};
use crate::response_utils::IntoHyperResponse;
use http::header::AUTHORIZATION;
/// Authentication is checked in two steps:
///  - check a header filled in by Nginx from a client certificate
///  - check the JWT token in the Authorization header
///
use http::StatusCode;
use hyper::{Body, Request, Response};
use std::fmt::{Display, Formatter};
use std::sync::Arc;
use tower_http::auth::AuthorizeRequest;
use tracing::{info, trace};

const SSL_HEADER_VERIFY: &str = "X-SSL-Client-Verify";
const SSL_HEADER_DN: &str = "X-SSL-Client-S-DN";

/// Bearer token is described here: <https://www.rfc-editor.org/rfc/rfc6750>
pub const BEARER: &str = "Bearer ";

#[derive(Clone, Copy)]
pub struct OrganizatorAuthorization;

#[derive(Debug, PartialEq, Eq)]
pub struct UserId(pub String);

impl Display for UserId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl<B> AuthorizeRequest<B> for OrganizatorAuthorization {
    type ResponseBody = Body;

    fn authorize(&mut self, request: &mut Request<B>) -> Result<(), Response<Self::ResponseBody>> {
        trace!("Checking authorization");
        // check if the url is in the list of allowed urls (e.g. /login)
        let Some(jot) = request
            .extensions()
            .get::<Arc<Jot>>()
            else {
                return Err("No Jot in the request".to_text_response_with_status(StatusCode::UNAUTHORIZED));
            };
        if jot.is_ignored_path(request.uri().path()) {
            return Ok(());
        }

        if let Some(user_id) = check_ssl_header(request) {
            trace!("User {} is authorized via ssl header", user_id.0);
            request.extensions_mut().insert(user_id);
            Ok(())
        } else if let Some(user_id) = check_jwt_header(request) {
            request.extensions_mut().insert(user_id);
            Ok(())
        } else {
            Err("Unauthorized request".to_text_response_with_status(StatusCode::UNAUTHORIZED))
        }
    }
}

fn check_ssl_header<B>(request: &Request<B>) -> Option<UserId> {
    trace!("Check if the certificate verification was successful");
    if request
        .headers()
        .get(SSL_HEADER_VERIFY)
        .and_then(|s| if s == "SUCCESS" { Some(()) } else {
            info!("Content of {SSL_HEADER_DN} is {:?} instead of SUCCESS", s);
            None 
        })
        .is_none()
    {
        info!("SSL verification failed");
        return None;
    }
    trace!("Check if the DN is present");
    match request.headers().get(SSL_HEADER_DN).map(|s| s.to_str()) {
        Some(Ok(dn)) if dn.len() > 3 && &dn[0..3] == "CN=" => Some(UserId(dn[3..].to_string())),
        _ => None,
    }
}

fn check_jwt_header<B>(request: &mut Request<B>) -> Option<UserId> {
    trace!("Checking for a JWT bearer token");
    match request.headers().get(AUTHORIZATION).map(|s| s.to_str()) {
        Some(Ok(bearer)) if bearer.len() > BEARER.len() => {
            let jwt = &bearer[BEARER.len()..];
            let jot = request.extensions().get::<Arc<Jot>>()?;
            if let Ok(claims) = jot.validate_token(jwt) {
                // verify the token has not expired
                match jot.check_expiration(&claims) {
                    ExpiredToken::Valid => Some(UserId(claims.sub)),
                    ExpiredToken::GracePeriod => {
                        // refresh the token
                        if let Ok(new_token) = jot.generate_token(&claims.sub) {
                            let header = String::from(BEARER) + &new_token;
                            request
                                .headers_mut()
                                .insert(AUTHORIZATION, header.parse().unwrap());
                            Some(UserId(claims.sub))
                        } else {
                            None
                        }
                    }
                    ExpiredToken::Expired => {
                        info!("Token expired");
                        None
                    }
                }
            } else {
                trace!("Invalid token");
                None
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::settings::SecurityConfig;
    use hyper::Error;
    use tower::{Service, ServiceBuilder, ServiceExt};
    use tower_http::add_extension::AddExtensionLayer;
    use tower_http::auth::RequireAuthorizationLayer;

    #[test]
    fn test_check_ssl_header() {
        let mut request = Request::new(Body::empty());
        request
            .headers_mut()
            .insert(SSL_HEADER_VERIFY, "SUCCESS".parse().unwrap());
        request
            .headers_mut()
            .insert(SSL_HEADER_DN, "CN=admin".parse().unwrap());
        assert_eq!(
            check_ssl_header(&mut request),
            Some(UserId("admin".to_string()))
        );
    }

    #[tokio::test]
    async fn test_check_jwt_header() {
        let mut request = Request::new(Body::empty());
        let jot = Jot::new(&SecurityConfig::default()).await.unwrap();
        let token = jot.generate_token("admin").unwrap();
        let header = String::from(BEARER) + &token;

        request
            .headers_mut()
            .insert(AUTHORIZATION, header.parse().unwrap());
        request.extensions_mut().insert(Arc::new(jot));
        assert_eq!(
            check_jwt_header(&mut request),
            Some(UserId("admin".to_string()))
        );
    }

    // Test using the header set by Nginx from a client certificate
    #[tokio::test]
    async fn integration_test() -> Result<(), Error> {
        pretty_env_logger::init();

        let mut service = ServiceBuilder::new()
            .layer(AddExtensionLayer::new(Arc::new(
                Jot::new(&SecurityConfig::default()).await.unwrap(),
            )))
            .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
            .service_fn(|_| async { Ok::<_, Error>(Response::new(Body::empty())) });

        let mut request = Request::new(Body::empty());
        // request with the header should be authorized
        request
            .headers_mut()
            .insert(SSL_HEADER_VERIFY, "SUCCESS".parse().unwrap());
        request
            .headers_mut()
            .insert(SSL_HEADER_DN, "CN=admin".parse().unwrap());
        let response = service.ready().await?.call(request).await?;
        println!("Response: {:#?}", &response);
        assert_eq!(response.status(), StatusCode::OK);

        // request without the header should be unauthorized
        let request = Request::new(Body::empty());
        let response = service.ready().await?.call(request).await?;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        Ok(())
    }

    macro_rules! test_with_env {
        ($expiry: expr, $grace: expr, $response: ident) => {
            let security_config = SecurityConfig {
                session_expiry:              $expiry,
                session_expiry_grace_period: $grace,
                ignore_paths:                vec![],
                public_key_url:              None,
            };
            let mut jot = Jot::new(&security_config).await.unwrap();
            jot.session_expiry = $expiry;
            jot.session_expiry_grace_period = $grace;
            let token = jot.generate_token("admin").unwrap();
            let mut service = ServiceBuilder::new()
                .layer(AddExtensionLayer::new(Arc::new(jot)))
                .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
                .service_fn(|_| async { Ok::<_, Error>(Response::new(Body::empty())) });
            let header = String::from(BEARER) + &token;
            let mut request = Request::new(Body::empty());

            // request with a valid JWT token should be authorized
            request
                .headers_mut()
                .insert(AUTHORIZATION, header.parse().unwrap());
            let $response = service.ready().await?.call(request).await?;
        };
    }

    // Test using the Authorization header with a JWT token
    #[tokio::test]
    async fn integration_test_jwt() -> Result<(), Error> {
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
