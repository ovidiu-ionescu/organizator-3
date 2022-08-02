use tower_http::auth::{RequireAuthorizationLayer, AuthorizeRequest};
use hyper::{Request, Response, Body, Error};
use http::{StatusCode, header::AUTHORIZATION};
use tower::{Service, ServiceExt, ServiceBuilder, service_fn};

const SSL_HEADER :&str ="X-SSL-Client-S-DN";

#[derive(Clone, Copy)]
pub struct OrganizatorAuthorization;

#[derive(Debug, PartialEq)]
pub struct UserId(String);

impl<B> AuthorizeRequest<B> for OrganizatorAuthorization {
    type ResponseBody = Body;

    fn authorize(&mut self, req: &mut Request<B>) -> Result<(), Response<Self::ResponseBody>> {
        if let Some(user_id) = check_authorization(req) {
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

fn check_authorization<B>(request: &Request<B>) -> Option<UserId> {
    match request.headers().get(SSL_HEADER).map(|s| s.to_str()) {
        Some(Ok(dn)) if dn.len() > 3 => Some(UserId(dn[3..].to_string())),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_authorization() {
        let mut request = Request::new(Body::empty());
        request.headers_mut().insert(SSL_HEADER, "CN=admin".parse().unwrap());
        assert_eq!(check_authorization(&mut request), Some(UserId("admin".to_string())));
    }
}
