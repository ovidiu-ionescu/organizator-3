use tower_http::auth::AuthorizeRequest;
use hyper::{Request, Response, Body};
use http::StatusCode;

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
    use tower::{Service, ServiceExt, ServiceBuilder};
    use http::header::AUTHORIZATION;
    use tower_http::auth::RequireAuthorizationLayer;
    use hyper::Error;

    #[test]
    fn test_check_authorization() {
        let mut request = Request::new(Body::empty());
        request.headers_mut().insert(SSL_HEADER, "CN=admin".parse().unwrap());
        assert_eq!(check_authorization(&mut request), Some(UserId("admin".to_string())));
    }

    #[tokio::test]
    async fn integration_test() -> Result<(), Error> {

        let mut service = ServiceBuilder::new()
            .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
            .service_fn(|_| async { Ok::<_, Error>(Response::new(Body::empty())) });

        let mut request = Request::new(Body::empty());
        request.headers_mut().insert(SSL_HEADER, "CN=admin".parse().unwrap());
        let response = service.ready().await?.call(request).await?;
        assert_eq!(response.status(), StatusCode::OK);

        let request = Request::new(Body::empty());
        let response = service.ready().await?.call(request).await?;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);


        Ok(())
    }
}
