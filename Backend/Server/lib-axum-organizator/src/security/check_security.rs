use crate::security::jot::{ExpiredToken, Jot, User};
use axum::{
    extract::Request,
    http::{HeaderMap, header},
};
/// Authentication is checked in two steps:
///  - check a header filled in by Nginx from a client certificate
///  - check the JWT token in the Authorization header
///
use tracing::{info, trace, debug};

const SSL_HEADER_VERIFY: &str = "X-SSL-Client-Verify";
const SSL_HEADER_DN: &str = "X-SSL-Client-S-DN";

/// Bearer token is described here: <https://www.rfc-editor.org/rfc/rfc6750>
pub const BEARER: &str = "Bearer ";

#[derive(Clone, Copy)]
pub struct OrganizatorAuthorization;

pub fn check_ssl_header(request: &mut Request) -> bool {
    trace!("Check if the certificate verification was successful");
    match request.headers().get(SSL_HEADER_VERIFY) {
        Some(s) if s == "SUCCESS" => (),
        Some(s) => {
            debug!(
                "Content of {SSL_HEADER_VERIFY} is {:?} instead of SUCCESS, cannot do SSL verification",
                s
            );
            return false;
        }
        None => {
            info!("No {SSL_HEADER_VERIFY} header, can not allow access without SSL verification");
            return false;
        }
    }
    trace!("Check if the DN is present");
    match request.headers().get(SSL_HEADER_DN).map(|s| s.to_str()) {
        Some(Ok(dn)) => {
            trace!("DN from header: {:?}", dn);
            match from_dn_header(dn) {
                Some(user) => {
                    trace!("User from DN: {:?}", user);
                    request.extensions_mut().insert(user);
                    true
                }
                None => {
                    info!("No valid user found in DN: {:?}", dn);
                    false
                }
            }
        }
        _ => {
            info!("No valid DN found in {SSL_HEADER_DN} header");
            false
        }
    }
}

/// Parse the DN header and extract the common name (CN) and organizational units (OU)
/// into a User struct. The CN is used as the user id and the OUs are used as roles.
/// Use a separate OU per role, e.g. "OU=orgadm" for the admin role.
pub fn from_dn_header(dn_str: &str) -> Option<User> {
    let mut common_name = None;
    let mut roles = Vec::new();

    // Split by commas, handling potential escaped characters if needed
    for part in dn_str.split(',') {
        let mut kv = part.trim().splitn(2, '=');
        if let (Some(key), Some(value)) = (kv.next(), kv.next()) {
            match key {
                "CN" => common_name = Some(value),
                "OU" => roles.push(value),
                _ => {}
            }
        }
    }
    common_name.map(|cn| User::new(cn, roles))
}

#[derive(Debug, PartialEq)]
pub enum JwtStatus {
    Ok,
    Grace(String),
    Expired,
    Invalid,
    NotFound,
    Error(String),
}

/// Check the JWT token in the Authorization header or in the cookie
/// If the token is almost expired, it will be refreshed and a new token will be set in the
/// Authorization header and in the cookie
///
/// Will check the request for the Authorization header or the cookie, validate it
/// and put the user information in the request extension.
///
/// @return
/// JWT_STATUS_OK if the token is valid and not expired
/// JWT_STATUS_GRACE if the token is valid but almost expired, a new token will be generated
/// JWT_STATUS_EXPIRED if the token is expired
/// JWT_STATUS_INVALID if the token is invalid
/// JWT_STATUS_NOT_FOUND if the token is not found in the request
pub fn check_jwt_header(request: &mut Request, jot: &Jot) -> JwtStatus {
    trace!("Checking the headers for a JWT bearer token");
    let jwt = extract_jwt(request.headers());
    let jwt = match jwt {
        Some(s) => s,
        None => {
            trace!("No jwt found in headers");
            return JwtStatus::NotFound;
        }
    };

    if let Ok(claims) = jot.validate_token(jwt) {
        // verify the token has not expired
        match jot.check_expiration(&claims) {
            ExpiredToken::Valid => {
                request.extensions_mut().insert(User::from(claims));
                JwtStatus::Ok
            }
            ExpiredToken::GracePeriod => {
                // refresh the token
                let temp: Vec<&str> = claims.roles.iter().map(|s| s.as_str()).collect();
                if let Ok(new_token) = jot.generate_token(&claims.sub, &temp) {
                    request.extensions_mut().insert(User::from(claims));
                    JwtStatus::Grace(new_token)
                } else {
                    JwtStatus::Error("Failed to refresh token".to_string())
                }
            }
            ExpiredToken::Expired => {
                info!("Token expired");
                JwtStatus::Expired
            }
        }
    } else {
        trace!("Invalid token");
        JwtStatus::Invalid
    }
}

/// Create the cookie string from the jwt string
pub fn create_security_cookie(jwt: &str) -> String {
    format!("__Host-jwt={jwt}; HttpOnly; Secure; SameSite=Strict; Path=/;")
}

/// Go through the headers and find the cookie with the given prefix,
/// return the value of the cookie if found
fn get_cookie_value<'a>(headers: &'a HeaderMap, cookie_name_prefix: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .flat_map(|s| s.split(';'))
        .find_map(|pair| {
            let pair = pair.trim();
            pair.strip_prefix(cookie_name_prefix)
        })
}

/// get the bearer token from the Authorization header as a string slice
fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    if let Some(auth_header) = headers.get(header::AUTHORIZATION)
        && let Ok(auth_str) = auth_header.to_str()
        && let Some(token) = auth_str.strip_prefix(BEARER)
    {
        return Some(token.trim());
    }
    None
}

const COOKIE_NAME_PREFIX: &str = "__Host-jwt=";
const COOKIE_NAME: &str = "__Host-jwt";

/// Extract the JWT token str from the Authorization header or from the cookie
pub fn extract_jwt(headers: &HeaderMap) -> Option<&str> {
    let bearer_token = extract_bearer(headers);
    if bearer_token.is_some() {
        trace!("Found header {} with bearer token", header::AUTHORIZATION);
        return bearer_token;
    } else {
        trace!(
            "Could not find header {} with bearer token",
            header::AUTHORIZATION
        );
    }
    let cookie_token = get_cookie_value(headers, COOKIE_NAME_PREFIX);
    if cookie_token.is_some() {
        trace!("Found cookie {COOKIE_NAME} with bearer token");
    } else {
        trace!("Cound not find cookie {COOKIE_NAME} with bearer token");
    }
    cookie_token
}

#[cfg(test)]
mod tests {

    use crate::security::security_settings::SecurityConfig;

    use super::*;
    use axum::body::Body;

    #[test]
    fn test_check_ssl_header() {
        let mut request = Request::new(Body::empty());
        request
            .headers_mut()
            .insert(SSL_HEADER_VERIFY, "SUCCESS".parse().unwrap());
        request
            .headers_mut()
            .insert(SSL_HEADER_DN, "CN=admin,OU=orgadm".parse().unwrap());
        assert!(check_ssl_header(&mut request));
        let user = request.extensions().get::<User>().unwrap();
        assert_eq!("admin", user.id());
        assert!(user.is_admin());
    }

    #[tokio::test]
    async fn test_check_jwt_header() {
        let jot = Jot::new(&SecurityConfig::default()).await.unwrap();
        let token = jot.generate_token("admin", &["orgadm"]).unwrap();
        let header = String::from(BEARER) + &token;

        let mut request = Request::builder()
            .header(header::AUTHORIZATION, header)
            .body(Body::empty())
            .unwrap();
        assert_eq!(check_jwt_header(&mut request, &jot), JwtStatus::Ok);
        let user = request.extensions().get::<User>().unwrap();
        assert_eq!("admin", user.id());
        assert!(user.is_admin());
    }

    /*
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
                session_expiry: $expiry,
                session_expiry_grace_period: $grace,
                ignore_paths: vec![],
                public_key_url: None,
            };
            let mut jot = Jot::new(&security_config).await.unwrap();
            jot.session_expiry = $expiry;
            jot.session_expiry_grace_period = $grace;
            let token = jot.generate_token("admin", &[]).unwrap();
            let mut service = ServiceBuilder::new()
                .layer(AddExtensionLayer::new(Arc::new(jot)))
                .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
                .service_fn(|_| async { Ok::<_, Error>(Response::new(Body::empty())) });
            let header = String::from(BEARER) + &token;
            let mut request = Request::new(Body::empty());

            // request with a valid JWT token should be authorized
            request
                .headers_mut()
                .insert(header::AUTHORIZATION, header.parse().unwrap());
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
    */
}
