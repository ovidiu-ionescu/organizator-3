use std::sync::Arc;

use futures::Future;
use http::{header::CONTENT_TYPE, Method, Request, Response, StatusCode};
use hyper::{Body, Server};

use tower::{make::Shared, ServiceBuilder};
use tower_http::add_extension::AddExtensionLayer;
use tracing::{info, trace};

use crate::{response_utils::IntoResultHyperResponse, settings::Settings, typedef::GenericError};

use super::prometheus_metrics::PrometheusMetrics;
use prometheus::{Encoder, TextEncoder};

async fn metrics_handler(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    trace!("metrics_handler");
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
        _ => "metrics_handler: no such url in the metrics endpoint"
            .to_text_response_with_status(StatusCode::NOT_FOUND),
    }
}

pub fn start_metrics_server(
    metrics: Arc<PrometheusMetrics>,
    settings: &Settings,
) -> impl Future<Output = Result<(), hyper::Error>> {
    let service = ServiceBuilder::new()
        .layer(AddExtensionLayer::new(metrics))
        .service_fn(metrics_handler);
    let metrics_ip = settings.metrics_ip();
    info!("start server on {}", &metrics_ip);
    Server::bind(&metrics_ip).serve(Shared::new(service))
}
