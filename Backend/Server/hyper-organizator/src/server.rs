use tower_http::{
    add_extension::AddExtensionLayer,
    compression::CompressionLayer,
    propagate_header::PropagateHeaderLayer,
    auth::RequireAuthorizationLayer,
    sensitive_headers::SetSensitiveRequestHeadersLayer,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tower::{ServiceBuilder, service_fn, make::Shared};
use http::{Request, Response, header::{HeaderName, CONTENT_TYPE, AUTHORIZATION}};
use hyper::{Body, Error, server::Server, service::make_service_fn, StatusCode, Method };
use std::{sync::{Arc, RwLock}, net::SocketAddr, convert::Infallible, iter::once};
use std::collections::HashMap;

use futures::StreamExt;
use crate::typedef::GenericError;

async fn unihandler(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    println!("Creds: 「{:#?}」, uri:「{}」", &request.headers().get("Authorization"), &request.uri().path());

    
    let make_body = |s: &str| Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .header("server", "hyper")
                .body(Body::from(s.to_string()))
                .unwrap();
        

    let tmp = Some("Hello, I have no telephone");
    let response = match tmp {
        Some(res) => { println!("Hit"); make_body(res) },
        None =>
                Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from(r#"{ "error_code": 404, "message": "HTTP 404 Not Found" }"#))
                .unwrap()
    };
    Ok(response)
}

async fn read_full_body(req: &mut Request<Body>) -> Result<Vec<u8>, Error> {
    let mut body = match req.headers().get("Content-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok()) {
            Some(len) => {
                Vec::with_capacity(len)
            },
            None => {
                Vec::new()},
        };
    while let Some(chunk) = req.body_mut().next().await {
        body.extend_from_slice(&chunk?);
    }
    Ok(body.to_vec())
}

struct State {
    content: String,
}

pub async fn start_servers() -> Result<(), Error> {
    // Setup tracing
    tracing_subscriber::fmt::init();
    
    let state = State { content: "Hello, world!".to_string() };

    let service = ServiceBuilder::new()
        // Mark the `Authorization` request header as sensitive so it doesn't show in logs
        // .layer(SetSensitiveRequestHeadersLayer::new(once(AUTHORIZATION)))
        // High level logging of requests and responses
        .layer(TraceLayer::new_for_http())
        // Share an `Arc<State>` with all requests
        .layer(AddExtensionLayer::new(Arc::new(RwLock::new(state))))
        // Compress responses
        .layer(CompressionLayer::new())
        // Propagate `X-Request-Id`s from requests to responses
        .layer(PropagateHeaderLayer::new(HeaderName::from_static("x-request-id")))
        // If the response has a known size set the `Content-Length` header
        // .layer(SetResponseHeaderLayer::overriding(CONTENT_TYPE, content_length_from_response))
        // Authorize requests using a token
        // .layer(RequireAuthorizationLayer::bearer("passwordlol"))
        // Wrap a `Service` in our middleware stack
        .service_fn(unihandler);

    // And run our service using `hyper`
    println!("start server on 127.0.0.1:3000");
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    Server::bind(&addr)
        .serve(Shared::new(service))
        .await
        .expect("server error");
    Ok(())
}  

