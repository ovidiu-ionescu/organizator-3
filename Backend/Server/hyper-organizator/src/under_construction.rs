use crate::typedef::GenericError;
use http::{Request, Response, StatusCode};
use hyper::Body;
use tracing::{debug, info};

/// Contains various functions that are not yet properly implemented.

pub async fn default_reply(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    debug!(
        "Creds: 「{:#?}」, uri:「{}」",
        &request.headers().get("Authorization"),
        &request.uri().path()
    );

    let make_body = |s: &str| {
        Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "application/json")
            .header("server", "hyper")
            .body(Body::from(s.to_string()))
            .unwrap()
    };

    let tmp = Some("Hello, I have no telephone\n");
    let response = match tmp {
        Some(res) => {
            info!("Hit");
            make_body(res)
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from(
                r#"{ "error_code": 404, "message": "HTTP 404 Not Found" }"#,
            ))
            .unwrap(),
    };
    Ok(response)
}
