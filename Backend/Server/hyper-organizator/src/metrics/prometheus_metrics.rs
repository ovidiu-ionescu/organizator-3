use opentelemetry::{
    global,
    metrics::{Counter, Histogram},
    sdk::{
        export::metrics::aggregation,
        metrics::{controllers, processors, selectors},
    },
    Context,
};
use opentelemetry_prometheus::PrometheusExporter;

pub struct PrometheusMetrics {
    pub context:            Context,
    pub exporter:           PrometheusExporter,
    pub http_counter:       Counter<u64>,
    pub http_body_gauge:    Histogram<u64>,
    pub http_req_histogram: Histogram<f64>,
}

impl PrometheusMetrics {
    pub fn new() -> Self {
        let controller = controllers::basic(
            processors::factory(
                selectors::simple::histogram([1.0, 2.0, 5.0, 10.0, 20.0, 50.0]),
                aggregation::cumulative_temporality_selector(),
            )
            .with_memory(true),
        )
        .build();
        let exporter = opentelemetry_prometheus::exporter(controller).init();
        // TODO: where is this label used?
        let meter = global::meter("ex.com/hyper");
        let context = Context::new();
        Self {
            context,

            exporter,
            http_counter: meter
                .u64_counter("service.http_requests_total")
                .with_description("Total number of HTTP requests made.")
                .init(),
            http_body_gauge: meter
                .u64_histogram("example.http_response_size_bytes")
                .with_description("The metrics HTTP response sizes in bytes.")
                .init(),
            http_req_histogram: meter
                .f64_histogram("example.http_request_duration_seconds")
                .with_description("The HTTP request latencies in seconds.")
                .init(),
        }
    }
}
