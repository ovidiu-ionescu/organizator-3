use std::{error::Error, net::SocketAddr};

use futures::Future;
use http::{Request, Response};
use hyper::{Body, Server};
use tower::{make::Shared, ServiceBuilder};
use tracing::info;

use crate::{typedef::GenericError, under_construction::default_reply};

async fn metrics_handler(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    default_reply(request).await
}

pub fn start_metrics_server() -> impl Future<Output = Result<(), hyper::Error>> {
    let service = ServiceBuilder::new().service_fn(metrics_handler);
    let addr_str = "127.0.0.1:3001";
    info!("start server on {}", &addr_str);
    let addr = addr_str.parse::<SocketAddr>().unwrap();
    Server::bind(&addr).serve(Shared::new(service))
}
