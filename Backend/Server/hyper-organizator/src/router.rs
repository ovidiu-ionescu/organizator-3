use crate::db;
use crate::model::GetMemo;
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
use tokio_postgres::Error as PgError;

/*
 * Routes to implement:
 get(/user/{id})                 get_user
 get(/user)                      get_users
✓get(/memo/)                     get_memo_titles
 post(/memo/search)              search_memo
✓get(/memo/{id})                 get_memo
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
        (&Method::GET, path) if MEMO_GET.is_match(path) => get_memo(&request).await,
        //        (&Method::GET, ref path) if MEMO_GROUP_GET.is_match(path) => get_memo_group(&request).await,
        (&Method::GET, "/memogroup") => get_memogroup_for_user(&request).await,
        _ => default_reply(request).await,
    }
}

async fn get_memo(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, username) = get_client_and_user(request).await?;

    let path = request.uri().path();
    let captures = MEMO_GET.captures(path).unwrap();
    let memo_id = captures.get(1).unwrap().as_str().parse::<i32>()?;
    let memo: Result<GetMemo, _> = db::get_by_id(&client, &memo_id, username).await;

    build_json_response(memo)
}

async fn get_memogroup_for_user(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, username) = get_client_and_user(request).await?;

    let memo_group: Result<Vec<crate::model::MemoGroup>, _> =
        db::get_for_user(&client, username).await;

    build_json_response(memo_group)
}

async fn get_client_and_user(
    request: &Request<Body>,
) -> Result<(deadpool_postgres::Client, &str), GenericError> {
    let client = get_connection(request).await?;
    // get the current logged in user from the request
    let Some(user_id) = request.extensions().get::<UserId>() else {
        return Err(GenericError::from("No user found in request, this should not happen"));
    };
    let username = &user_id.0;
    Ok((client, username))
}

fn build_json_response<T: serde::Serialize>(
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
        Err(_x) => GenericMessage::internal_server_error(),
    }
}
