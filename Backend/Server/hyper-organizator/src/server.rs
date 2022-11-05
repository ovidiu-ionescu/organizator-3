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
    add_extension::AddExtensionLayer,
    auth::RequireAuthorizationLayer,
    compression::CompressionLayer,
    propagate_header::PropagateHeaderLayer,
    sensitive_headers::SetSensitiveRequestHeadersLayer,
    set_header::SetResponseHeaderLayer,
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};

use crate::authentication::authorize_header::Jot;
use crate::authentication::check_security::{OrganizatorAuthorization, UserId};
use crate::authentication::login::login;
use crate::metrics::numeric_request_id::NumericMakeRequestId;
use crate::typedef::GenericError;
use crate::under_construction::default_reply;
use futures::StreamExt;
use tower_http::request_id::{
    MakeRequestId, PropagateRequestIdLayer, RequestId, SetRequestIdLayer,
};
use tracing::{debug, info};

// use crate::myservice::print_service::PrintLayer;

/// All requests to the server are handled by this function.
async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::POST, "/login") => login(request).await,
        _ => default_reply(request).await,
    }
}

pub async fn start_servers() -> Result<(), Error> {
    // Setup tracing
    tracing_subscriber::fmt::init();

    let x_request_id = HeaderName::from_static("x-request-id");

    let service = ServiceBuilder::new()
        // set `x-request-id` header on all requests
        .layer(SetRequestIdLayer::new(
            x_request_id.clone(),
            NumericMakeRequestId::default(),
        ))
        // Mark the `Authorization` request header as sensitive so it doesn't show in logs
        .layer(SetSensitiveRequestHeadersLayer::new(once(AUTHORIZATION)))
        // High level logging of requests and responses
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().include_headers(true))
                .on_response(DefaultOnResponse::new().include_headers(true)),
        )
        // Share an `Arc<State>` with all requests
        .layer(AddExtensionLayer::new(Arc::new(Jot::new().unwrap())))
        // Compress responses
        .layer(CompressionLayer::new())
        // Propagate `X-Request-Id`s from requests to responses
        .layer(PropagateHeaderLayer::new(x_request_id))
        // Propagate the JWT token from the request to the response; if it's close
        // to expiring, a new one will be generated and returned in the response
        .layer(PropagateHeaderLayer::new(AUTHORIZATION))
        // If the response has a known size set the `Content-Length` header
        // .layer(SetResponseHeaderLayer::overriding(CONTENT_TYPE, content_length_from_response))
        // Authorize requests using a token
        .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
        // .layer(PrintLayer)
        // Wrap a `Service` in our middleware stack
        .service_fn(router);

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
