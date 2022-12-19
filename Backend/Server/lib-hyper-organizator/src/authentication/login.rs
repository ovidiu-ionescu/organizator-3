use crate::authentication::jot::Jot;
use crate::response_utils::{read_full_body, GenericMessage};
use crate::typedef::GenericError;
use http::{Request, Response};
use hyper::Body;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{info, warn};
use url::form_urlencoded;

pub async fn login(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    info!("Login");
    // parse the body and fetch the username and password
    let body = read_full_body(&mut request).await?;
    let params = form_urlencoded::parse(&body)
        .into_owned()
        .collect::<HashMap<String, String>>();
    let Some(username) = params.get("username") else {
        warn!("No username");
        return GenericMessage::bad_request();
    };
    let Some(password) = params.get("password") else {
        warn!("No password");
        return GenericMessage::bad_request();
    };
    // check the username and password
    // FIXME: this is a placeholder
    if username != "admin" || password != "admin" {
        warn!("Bad username or password");
        return GenericMessage::unauthorized();
    }

    let Some(jot) = request.extensions().get::<Arc<Jot>>() else {
        return GenericMessage::error();
    };
    let new_token: String = jot.generate_token(username)?;
    info!("User 「{}」 logged in", &username);

    GenericMessage::text_reply(&new_token)
}
