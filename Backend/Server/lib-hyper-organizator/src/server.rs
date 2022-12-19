use crate::{logging::logging_trace_span::TraceRequestMakeSpan, settings::Settings};
use http::{
    header::{HeaderName, AUTHORIZATION},
    Request, Response,
};
use hyper::{server::Server, Body, Error};
use std::{iter::once, sync::Arc};
use tower::{make::Shared, ServiceBuilder};
use tower_http::{
    add_extension::AddExtensionLayer, auth::RequireAuthorizationLayer,
    compression::CompressionLayer, propagate_header::PropagateHeaderLayer,
    sensitive_headers::SetSensitiveRequestHeadersLayer, trace::TraceLayer,
};

use crate::metrics::numeric_request_id::NumericMakeRequestId;
use crate::typedef::GenericError;
use crate::{
    authentication::check_security::OrganizatorAuthorization,
    metrics::prometheus_metrics::PrometheusMetrics,
};
use crate::{authentication::jot::Jot, metrics::metrics_layer::MetricsLayer};
use tower_http::request_id::SetRequestIdLayer;
use tower_layer::Stack;
use tracing::info;

#[cfg(feature = "security")]
fn add_authorization<L>(
    service_builder: ServiceBuilder<L>,
) -> ServiceBuilder<
    Stack<RequireAuthorizationLayer<OrganizatorAuthorization>, Stack<PropagateHeaderLayer, L>>,
> {
    info!("Security enabled");
    // Propagate the JWT token from the request to the response; if it's close
    // to expiring, a new one will be generated and returned in the response
    service_builder
        .layer(PropagateHeaderLayer::new(AUTHORIZATION))
        // If the response has a known size set the `Content-Length` header
        // .layer(SetResponseHeaderLayer::overriding(CONTENT_TYPE, content_length_from_response))
        // Authorize requests using a token
        .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
}

#[cfg(not(feature = "security"))]
fn add_authorization<L>(service_builder: ServiceBuilder<L>) -> ServiceBuilder<L> {
    info!("Security disabled");
    service_builder
}

pub async fn start_servers<H, R>(f: H) -> Result<(), Error>
where
    H: FnMut(Request<Body>) -> R + Clone + Send + 'static,
    R: futures_util::Future<Output = Result<Response<Body>, GenericError>> + Send + 'static,
{
    let settings = Settings::new();

    let x_request_id = HeaderName::from_static("x-request-id");

    let metrics = Arc::new(PrometheusMetrics::new());

    let service_builder = ServiceBuilder::new()
        // set `x-request-id` header on all requests
        .layer(SetRequestIdLayer::new(
            x_request_id.clone(),
            NumericMakeRequestId::default(),
        ))
        .layer(AddExtensionLayer::new(metrics.clone()))
        .layer(MetricsLayer)
        // Mark the `Authorization` request header as sensitive so it doesn't show in logs
        .layer(SetSensitiveRequestHeadersLayer::new(once(AUTHORIZATION)))
        // High level logging of requests and responses
        .layer(
            TraceLayer::new_for_http().make_span_with(
                TraceRequestMakeSpan::new(tracing::Level::INFO), /*
                                                                 DefaultMakeSpan::new()
                                                                     .include_headers(true)
                                                                     .level(tracing::Level::INFO),
                                                                 */
            ), /*
               .on_request(
                   DefaultOnRequest::new()
                       //.include_headers(true)
                       .level(tracing::Level::INFO),
               )
               .on_response(
                   DefaultOnResponse::new()
                       .include_headers(true)
                       .level(tracing::Level::INFO),
               ),
               */
        )
        // Share an `Arc<State>` with all requests
        .layer(AddExtensionLayer::new(Arc::new(Jot::new().unwrap())))
        // Compress responses
        .layer(CompressionLayer::new())
        // Propagate `X-Request-Id`s from requests to responses
        .layer(PropagateHeaderLayer::new(x_request_id));

    let service_builder = add_authorization(service_builder);
    // Wrap a `Service` in our middleware stack
    let service = service_builder.service_fn(f);

    // And run our service using `hyper`
    let api_ip = settings.api_ip();
    info!("start server on {}", &api_ip);
    let main_server = Server::bind(&api_ip).serve(Shared::new(service));
    let metrics_server = crate::metrics::metrics_endpoint::start_metrics_server(metrics, &settings);
    futures::try_join!(main_server, metrics_server).expect("server error");
    Ok(())
}
