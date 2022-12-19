use std::sync::Arc;

use futures::Future;
use http::{header::CONTENT_TYPE, Method, Request, Response};
use hyper::{Body, Server};

use tower::{make::Shared, ServiceBuilder};
use tower_http::add_extension::AddExtensionLayer;
use tracing::info;

use crate::{settings::Settings, typedef::GenericError, under_construction::default_reply};

use super::prometheus_metrics::PrometheusMetrics;
use prometheus::{Encoder, TextEncoder};

async fn metrics_handler(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    //default_reply(request).await
    match (request.method(), request.uri().path()) {
        (&Method::GET, "/metrics") => {
            let mut buffer = vec![];
            let encoder = TextEncoder::new();
            let metrics = request
                .extensions()
                .get::<Arc<PrometheusMetrics>>()
                .unwrap();
            let metric_families = metrics.exporter.registry().gather();
            encoder.encode(&metric_families, &mut buffer).unwrap();
            metrics
                .http_body_gauge
                .record(&metrics.context, buffer.len() as u64, &[]);

            Ok(Response::builder()
                .status(200)
                .header(CONTENT_TYPE, encoder.format_type())
                .body(Body::from(buffer))
                .unwrap())
        }
        _ => default_reply(request).await,
    }
}

pub fn start_metrics_server(
    metrics: Arc<PrometheusMetrics>,
    settings: &Settings,
) -> impl Future<Output = Result<(), hyper::Error>> {
    let service = ServiceBuilder::new()
        .layer(AddExtensionLayer::new(metrics.clone()))
        .service_fn(metrics_handler);
    let metrics_ip = settings.metrics_ip();
    info!("start server on {}", &metrics_ip);
    Server::bind(&metrics_ip).serve(Shared::new(service))
}
