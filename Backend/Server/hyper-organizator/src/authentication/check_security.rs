use crate::authentication::authorize_header::Jot;
use http::header::AUTHORIZATION;
/// Authentication is checked in two steps:
///  - check a header filled in by Nginx from a client certificate
///  - check the JWT token in the Authorization header
///
use http::StatusCode;
use hyper::{Body, Request, Response};
use std::sync::{Arc, RwLock};
use tower_http::auth::AuthorizeRequest;

const SSL_HEADER: &str = "X-SSL-Client-S-DN";

#[derive(Clone, Copy)]
pub struct OrganizatorAuthorization;

#[derive(Debug, PartialEq, Eq)]
pub struct UserId(String);

impl<B> AuthorizeRequest<B> for OrganizatorAuthorization {
    type ResponseBody = Body;

    fn authorize(&mut self, req: &mut Request<B>) -> Result<(), Response<Self::ResponseBody>> {
        if let Some(user_id) = check_ssl_header(req) {
            req.extensions_mut().insert(user_id);
            Ok(())
        } else if let Some(user_id) = check_jwt_header(req) {
            req.extensions_mut().insert(user_id);
            Ok(())
        } else {
            Err(Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(Body::empty())
                .unwrap())
        }
    }
}

fn check_ssl_header<B>(request: &Request<B>) -> Option<UserId> {
    match request.headers().get(SSL_HEADER).map(|s| s.to_str()) {
        Some(Ok(dn)) if dn.len() > 3 => Some(UserId(dn[3..].to_string())),
        _ => None,
    }
}

fn check_jwt_header<B>(request: &Request<B>) -> Option<UserId> {
    match request.headers().get(AUTHORIZATION).map(|s| s.to_str()) {
        Some(Ok(jwt)) => {
            let jot = request.extensions().get::<Arc<Jot>>()?;
            if let Ok(username) = jot.validate_token(jwt) {
                Some(UserId(username))
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::Error;
    use tower::{Service, ServiceBuilder, ServiceExt};
    use tower_http::add_extension::AddExtensionLayer;
    use tower_http::auth::RequireAuthorizationLayer;

    #[test]
    fn test_check_ssl_header() {
        let mut request = Request::new(Body::empty());
        request
            .headers_mut()
            .insert(SSL_HEADER, "CN=admin".parse().unwrap());
        assert_eq!(
            check_ssl_header(&mut request),
            Some(UserId("admin".to_string()))
        );
    }

    #[test]
    fn test_check_jwt_header() {
        let mut request = Request::new(Body::empty());
        let jot = Jot::new().unwrap();
        let token = jot.generate_token("admin", 3600).unwrap();

        request
            .headers_mut()
            .insert(AUTHORIZATION, token.parse().unwrap());
        request.extensions_mut().insert(Arc::new(jot));
        assert_eq!(
            check_jwt_header(&mut request),
            Some(UserId("admin".to_string()))
        );
    }

    #[tokio::test]
    async fn integration_test() -> Result<(), Error> {
        let mut service = ServiceBuilder::new()
            .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
            .service_fn(|_| async { Ok::<_, Error>(Response::new(Body::empty())) });

        let mut request = Request::new(Body::empty());
        request
            .headers_mut()
            .insert(SSL_HEADER, "CN=admin".parse().unwrap());
        let response = service.ready().await?.call(request).await?;
        assert_eq!(response.status(), StatusCode::OK);

        let request = Request::new(Body::empty());
        let response = service.ready().await?.call(request).await?;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        Ok(())
    }

    #[tokio::test]
    async fn integration_test_jwt() -> Result<(), Error> {
        let jot = Jot::new().unwrap();
        let token = jot.generate_token("admin", 3600).unwrap();
        let mut service = ServiceBuilder::new()
            .layer(AddExtensionLayer::new(Arc::new(jot)))
            .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
            .service_fn(|_| async { Ok::<_, Error>(Response::new(Body::empty())) });
        let mut request = Request::new(Body::empty());

        request
            .headers_mut()
            .insert(AUTHORIZATION, token.parse().unwrap());
        let response = service.ready().await?.call(request).await?;
        assert_eq!(response.status(), StatusCode::OK);
        Ok(())
    }
}
