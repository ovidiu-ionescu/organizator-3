use crate::db;
use crate::model::ExplicitPermission;
use crate::model::Memo;
use crate::model::MemoTitle;
use crate::model::Named;
use crate::model::Requester;
use crate::model::User;
use http::StatusCode;
use http::{Method, Request, Response};
use hyper::Body;
use lazy_static::lazy_static;
use lib_hyper_organizator::authentication::check_security::UserId;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::IntoResultHyperResponse;
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_response;
use log::debug;
use regex::Regex;
use serde_json::json;
use tokio_postgres::Error as PgError;

/*
 * Routes to implement:
 get(/user/{id})                 get_user
 get(/user)                      get_users
 get(/memo/)                     get_memo_titles
 post(/memo/search)              search_memo
✓get(/memo/{id})                 get_memo
 post(/memo/)                    memo_write
✓get(/memogroup)                 get_memo_group
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
    static ref EXPLICIT_PERMISSIONS: Regex = Regex::new(r"^/explicit_permissions/(\d+)$").unwrap();
}

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), request.uri().path()) {
        (&Method::GET, path) if MEMO_GET.is_match(path) => get_memo(&request).await,
        (&Method::GET, "/memogroup") => get_memogroups_for_user(&request).await,
        (&Method::GET, "/memo/") => get_memo_titles(&request).await,
        (&Method::GET, path) if EXPLICIT_PERMISSIONS.is_match(path) => {
            get_explicit_permissions(&request).await
        }
        _ => default_response(request).await,
    }
}

#[utoipa::path(get, path="/memo/{id}",
    responses(
        (status=200, description="Memo", body=Memo),
    ),
    params(
        ("id" = i32, Path, description="Memo id"),
    ),
)]
async fn get_memo(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(request).await?;

    let path = request.uri().path();
    let captures = MEMO_GET.captures(path).unwrap();
    let memo_id = captures.get(1).unwrap().as_str().parse::<i32>()?;
    let memo: Result<Memo, _> = db::get_single(&client, &[&memo_id]).await;
    
    build_json_response(memo, requester)
}

#[utoipa::path(get, path="/memogroup",
    responses(
        (status=200, description="MemoGroup for current logged in user", body=MemoGroupList),
    ),
)]
async fn get_memogroups_for_user(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(request).await?;

    let memo_group: Result<Vec<crate::model::MemoGroup>, _> =
        db::get_multiple(&client, &[&requester.username]).await;

    build_json_response(memo_group, requester)
}

#[utoipa::path(get, path="/explicit_permissions/{id}",
    responses(
        (status=200, description="Explicit permissions for a memogroup", body=Vec<ExplicitPermission>),
    ),
    params(
        ("id" = i32, Path, description="MemoGroup id"),
    ),
)]
async fn get_explicit_permissions(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(request).await?;

    let path = request.uri().path();
    let captures = EXPLICIT_PERMISSIONS.captures(path).unwrap();
    let memogroup_id = captures.get(1).unwrap().as_str().parse::<i32>()?;
    let permissions: Result<Vec<ExplicitPermission>, _> =
        db::get_multiple(&client, &[&memogroup_id, &requester.username]).await;

    build_json_response(permissions, requester)
}

#[utoipa::path(get, path="/memo/",
    responses(
        (status=200, description="Memo titles for current logged in user", body=MemoTitleList),
    ),
)]
async fn get_memo_titles(request: &Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(request).await?;

    let memo_titles: Result<Vec<MemoTitle>, _> = db::get_multiple(&client, &[]).await;

    build_json_response(memo_titles, requester)
}

/// Fetch the database connection and the current user from the request.
async fn get_client_and_user(
    request: &Request<Body>,
) -> Result<(deadpool_postgres::Client, Requester), GenericError> {
    let client = get_connection(request).await?;
    // get the current logged in user from the request
    let Some(user_identification) = request.extensions().get::<UserId>() else {
        return Err(GenericError::from("No user found in request, this should not happen"));
    };
    let username = &user_identification.0;

    let set_var = client.prepare_cached(include_str!("sql/set_current_user.sql")).await?;
    let result = client.query_one(&set_var, &[&username]).await?;
    let user_id = result.get::<_, i32>(0);
    debug!("User id for {username} is {user_id}");

    Ok((client, Requester { id: user_id, username }))
}

fn build_json_response<T: serde::Serialize + Named>(
    data_result: Result<T, PgError>,
    requester: Requester,
) -> Result<Response<Body>, GenericError> {
    match data_result {
        Ok(data) => {
          let result = json!({
            T::name(): data,
            "requester": requester,
          });
          serde_json::to_string(&result)?.to_json_response()
        },
        Err(e) if e.code().is_some() => match e.code().unwrap().code() {
            "2F004" => "Data access forbidden".to_text_response_with_status(StatusCode::FORBIDDEN),
            "28000" => {
                "Data access unauthorized".to_text_response_with_status(StatusCode::UNAUTHORIZED)
            }
            "02000" => "No data found".to_text_response_with_status(StatusCode::NOT_FOUND),
            _ => e
                .to_string()
                .to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR),
        },
        Err(x) => x
            .to_string()
            .to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub use swagger::swagger_json;
mod swagger {
    use crate::model::{
        ExplicitPermission, GetWriteMemo, Memo, MemoGroup, MemoGroupList, MemoTitle, MemoTitleList, MemoUser, Requester, User
    };
    use utoipa::{
        openapi::security::{ApiKey, ApiKeyValue, HttpAuthScheme, HttpBuilder, SecurityScheme},
        Modify, OpenApi,
    };

    #[derive(OpenApi)]
    #[openapi(
        paths(super::get_memo, super::get_memogroups_for_user, super::get_explicit_permissions),
        components(
          schemas(
            ExplicitPermission,
            GetWriteMemo,
            Memo,
            MemoGroup,
            MemoGroupList,
            MemoTitle,
            MemoTitleList,
            MemoUser,
            User,
            Requester,
          ),
        ),
        modifiers(&SecurityAddonBearer),
        security(("api_key" = [])),
    )]
    pub struct ApiDoc;

    struct SecurityAddon;
    impl Modify for SecurityAddon {
        fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
            let components = openapi.components.as_mut().unwrap();
            components.add_security_scheme(
                "api_key",
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("X-Authorization"))),
            );
        }
    }

    struct SecurityAddonBearer;
    impl Modify for SecurityAddonBearer {
        fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
            let components = openapi.components.as_mut().unwrap();
            components.add_security_scheme(
                "api_key",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }

    pub fn swagger_json() -> String {
        serde_json::to_string_pretty(&ApiDoc::openapi()).unwrap()
    }
}
