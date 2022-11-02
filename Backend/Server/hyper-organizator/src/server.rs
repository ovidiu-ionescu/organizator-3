use http::{
    header::{HeaderName, AUTHORIZATION, CONTENT_TYPE},
    Request, Response,
};
use hyper::{server::Server, service::make_service_fn, Body, Error, Method, StatusCode};
use std::collections::HashMap;
use std::{
    convert::Infallible,
    iter::once,
    net::SocketAddr,
    sync::{Arc, RwLock},
};
use tower::{make::Shared, service_fn, ServiceBuilder};
use tower_http::{
    add_extension::AddExtensionLayer, auth::RequireAuthorizationLayer,
    compression::CompressionLayer, propagate_header::PropagateHeaderLayer,
    sensitive_headers::SetSensitiveRequestHeadersLayer, set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

use crate::authentication::authorize_header::Jot;
use crate::authentication::check_security::{OrganizatorAuthorization, UserId};
use crate::typedef::GenericError;
use futures::StreamExt;
use tracing::{debug, info};

// use crate::myservice::print_service::PrintLayer;

/// All requests to the server are handled by this function.
async fn unihandler(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    debug!(
        "Creds: 「{:#?}」, uri:「{}」",
        &request.headers().get("Authorization"),
        &request.uri().path()
    );

    let make_body = |s: &str| {
        Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "application/json")
            .header("server", "hyper")
            .body(Body::from(s.to_string()))
            .unwrap()
    };

    let tmp = Some("Hello, I have no telephone\n");
    let response = match tmp {
        Some(res) => {
            info!("Hit");
            make_body(res)
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from(
                r#"{ "error_code": 404, "message": "HTTP 404 Not Found" }"#,
            ))
            .unwrap(),
    };
    Ok(response)
}

async fn read_full_body(req: &mut Request<Body>) -> Result<Vec<u8>, Error> {
    let mut body = match req
        .headers()
        .get("Content-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
    {
        Some(len) => Vec::with_capacity(len),
        None => Vec::new(),
    };
    while let Some(chunk) = req.body_mut().next().await {
        body.extend_from_slice(&chunk?);
    }
    Ok(body.to_vec())
}

pub async fn start_servers() -> Result<(), Error> {
    // Setup tracing
    tracing_subscriber::fmt::init();

    let service = ServiceBuilder::new()
        // Mark the `Authorization` request header as sensitive so it doesn't show in logs
        // .layer(SetSensitiveRequestHeadersLayer::new(once(AUTHORIZATION)))
        // High level logging of requests and responses
        .layer(TraceLayer::new_for_http())
        // Share an `Arc<State>` with all requests
        .layer(AddExtensionLayer::new(Arc::new(Jot::new().unwrap())))
        // Compress responses
        .layer(CompressionLayer::new())
        // Propagate `X-Request-Id`s from requests to responses
        .layer(PropagateHeaderLayer::new(HeaderName::from_static(
            "x-request-id",
        )))
        // Propagate the JWT token from the request to the response; if it's close
        // to expiring, a new one will be generated and returned in the response
        .layer(PropagateHeaderLayer::new(AUTHORIZATION))
        // If the response has a known size set the `Content-Length` header
        // .layer(SetResponseHeaderLayer::overriding(CONTENT_TYPE, content_length_from_response))
        // Authorize requests using a token
        .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
        // .layer(PrintLayer)
        // Wrap a `Service` in our middleware stack
        .service_fn(unihandler);

    // And run our service using `hyper`
    let addr_str = "127.0.0.1:3000";
    info!("start server on {}", &addr_str);
    let addr = addr_str.parse::<SocketAddr>().unwrap();
    Server::bind(&addr)
        .serve(Shared::new(service))
        .await
        .expect("server error");
    Ok(())
}
