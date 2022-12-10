use http::Request;
use tower_http::trace::MakeSpan;
use tracing::{Level, Span};

#[derive(Debug, Clone)]
pub struct TraceRequestMakeSpan {
    level: Level,
}

impl TraceRequestMakeSpan {
    pub fn new(level: Level) -> Self {
        Self { level }
    }
    pub fn level(mut self, level: Level) -> Self {
        self.level = level;
        self
    }
}

impl Default for TraceRequestMakeSpan {
    fn default() -> Self {
        Self::new(Level::INFO)
    }
}

impl<B> MakeSpan<B> for TraceRequestMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        macro_rules! make_span {
            ($level:expr) => {
                tracing::span!(
                    $level,
                    "request",
                    id = request.headers().get("x-request-id").unwrap_or(&"no-id".parse().unwrap()).to_str().unwrap(),
                    uri = %request.uri(),
                )
            }
        }
        match self.level {
            Level::ERROR => {
                make_span!(Level::ERROR)
            }
            Level::WARN => {
                make_span!(Level::WARN)
            }
            Level::INFO => {
                make_span!(Level::INFO)
            }
            Level::DEBUG => {
                make_span!(Level::DEBUG)
            }
            Level::TRACE => {
                make_span!(Level::TRACE)
            }
        }
    }
}
