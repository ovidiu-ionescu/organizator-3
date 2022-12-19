use futures::Future;
use futures_util::ready;
use http::{Request, Response};
use pin_project_lite::pin_project;
use std::pin::Pin;
use std::{
    sync::Arc,
    task::{Context, Poll},
    time::SystemTime,
};
use tower::Layer;
use tower_service::Service;

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

impl<ReqBody, ResBody, S> tower::Service<Request<ReqBody>> for MetricsService<S>
where
    S: Service<Request<ReqBody>, Response = Response<ResBody>>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = ResponseFuture<S::Future>;

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
        let metrics = metrics.clone();
        let request_start = SystemTime::now();
        ResponseFuture {
            inner: self.inner.call(request),
            metrics,
            request_start,
        }
    }
}
pin_project! {
pub struct ResponseFuture<F> {
    #[pin]
    inner:         F,
    metrics:       Arc<PrometheusMetrics>,
    request_start: SystemTime,
}
}
impl<F, ResBody, E> Future for ResponseFuture<F>
where
    F: Future<Output = Result<Response<ResBody>, E>>,
{
    type Output = F::Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();
        let response = ready!(this.inner.poll(cx)?);
        let request_duration = this
            .request_start
            .elapsed()
            .map_or(0.0, |d| d.as_secs_f64());
        this.metrics
            .http_req_histogram
            .record(&this.metrics.context, request_duration, &[]);
        Poll::Ready(Ok(response))
    }
}
