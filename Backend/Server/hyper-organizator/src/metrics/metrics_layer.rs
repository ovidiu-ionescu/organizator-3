use std::{sync::Arc, time::SystemTime};

use http::Request;
use tower::Layer;

use super::prometheus_metrics::PrometheusMetrics;

pub struct MetricsLayer;

impl<S> Layer<S> for MetricsLayer {
    type Service = MetricsService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        MetricsService { inner }
    }
}

#[derive(Clone)]
pub struct MetricsService<S> {
    inner: S,
}

impl<S, ReqBody> tower::Service<Request<ReqBody>> for MetricsService<S>
where
    S: tower::Service<Request<ReqBody>>,
    ReqBody: std::fmt::Debug,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = S::Future;

    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request<ReqBody>) -> Self::Future {
        let metrics = request
            .extensions()
            .get::<Arc<PrometheusMetrics>>()
            .unwrap();
        metrics.http_counter.add(&metrics.context, 1, &[]);
        let request_start = SystemTime::now();
        self.inner.call(request)
    }
}
