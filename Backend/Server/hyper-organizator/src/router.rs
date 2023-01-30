use crate::db;
use http::{Method, Request, Response};
use hyper::Body;
use lazy_static::lazy_static;
use lib_hyper_organizator::authentication::check_security::UserId;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::GenericMessage;
use lib_hyper_organizator::response_utils::PolymorphicGenericMessage;
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_reply;
use regex::Regex;
use std::error::Error;
use tokio_postgres::Error as PgError;

/*
 * Routes to implement:
 get(/user/{id})                 get_user
 get(/user)                      get_users
 get(/memo/)                     get_memo_titles
 post(/memo/search)              search_memo
 get(/memo/{id})                 get_memo
 post(/memo/)                    memo_write
 get(/memogroup)                 get_memo_group
 put(/upload)                    upload_file
 get(/file_auth)                 file_auth
 get(/explicit_permissions/{id}) explicit_permissions

moved to identity:
            login
            logout
            change_password
kubernetes:
            version

*/

lazy_static! {
    static ref MEMO_GET: Regex = Regex::new(r"^/memo/(\d+)$").unwrap();
    static ref MEMO_GROUP_GET: Regex = Regex::new(r"^/memogroup/(\d+)$").unwrap();
    static ref USER_GET: Regex = Regex::new(r"^/user/(\d+)$").unwrap();
}

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::GET, ref path) if MEMO_GET.is_match(path) => get_memo(&request).await,
        _ => default_reply(request).await,
    }
}

async fn get_memo(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let path = request.uri().path();
    let captures = MEMO_GET.captures(path).unwrap();
    let memo_id = captures.get(1).unwrap().as_str().parse::<i32>()?;
    // get the current logged in user from the request
    let Some(user_id) = request.extensions().get::<UserId>() else {
        return GenericMessage::unauthorized();
    };
    let username = &user_id.0;

    let client = get_connection(&request).await?;

    let memo = db::get_memo(&client, memo_id, &username).await;
    build_response(memo)
    //Ok(Response::new(Body::from(serde_json::to_string(&memo)?)))
}

fn build_response<T: serde::Serialize>(
    data_result: Result<T, PgError>,
) -> Result<Response<Body>, GenericError> {
    match data_result {
        Ok(data) => GenericMessage::json_response(&serde_json::to_string(&data)?),
        Err(e) if e.code().is_some() => match e.code().unwrap().code() {
            "2F004" => GenericMessage::forbidden(),
            "28000" => GenericMessage::unauthorized(),
            "02000" => GenericMessage::not_found(),
            _ => GenericMessage::internal_server_error(),
        },
        Err(x) => GenericMessage::internal_server_error(),
    }
}
