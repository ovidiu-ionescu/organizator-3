use crate::{logging::logging_trace_span::TraceRequestMakeSpan, settings::Settings};
use http::{
    header::{HeaderName, AUTHORIZATION},
    Request, Response,
};
use hyper::{server::Server, Body, Error};
use std::{iter::once, sync::Arc};
use tower::{make::Shared, ServiceBuilder};
use tower_http::{
    add_extension::AddExtensionLayer, compression::CompressionLayer,
    propagate_header::PropagateHeaderLayer, sensitive_headers::SetSensitiveRequestHeadersLayer,
    trace::TraceLayer,
};

use crate::authentication::authentication_layers::add_authorization;
use crate::metrics::metrics_layer::MetricsLayer;
use crate::metrics::numeric_request_id::NumericMakeRequestId;
use crate::metrics::prometheus_metrics::PrometheusMetrics;
use crate::postgres::add_database;
use crate::typedef::GenericError;
use tower_http::request_id::SetRequestIdLayer;
use tracing::info;

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
            TraceLayer::new_for_http()
                // no events handled in trace yet, e.g. on_request, on_response
                .make_span_with(TraceRequestMakeSpan::new(tracing::Level::INFO)),
        )
        // Compress responses
        .layer(CompressionLayer::new())
        // Propagate `X-Request-Id`s from requests to responses
        .layer(PropagateHeaderLayer::new(x_request_id));

    // Add security if enabled
    let service_builder = add_authorization(service_builder);
    // Add a database pool if enabled
    let service_builder = add_database(service_builder, settings.postgres.clone());
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
