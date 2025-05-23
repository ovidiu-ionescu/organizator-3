use std::collections::HashSet;

use crate::db;
use crate::db::QueryType::{ Select, Search };
use crate::model::{ExplicitPermission, FilePermission, FilestoreFile, FilestoreFileDB, GetWriteMemo};
use crate::model::Memo;
use crate::model::MemoTitle;
use crate::model::Named;
use crate::model::Requester;
use lib_hyper_organizator::multipart::{Field, FileField, RegularField, handle_multipart};
use http::StatusCode;
use http::{Method, Request, Response};
use hyper::Body;
use lazy_static::lazy_static;
use lib_hyper_organizator::authentication::check_security::UserId;
use lib_hyper_organizator::postgres::get_connection;
use lib_hyper_organizator::response_utils::parse_body;
use lib_hyper_organizator::response_utils::IntoResultHyperResponse;
use lib_hyper_organizator::server::SETTINGS;
use lib_hyper_organizator::typedef::GenericError;
use lib_hyper_organizator::under_construction::default_response;
use log::{error, debug, trace};
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
 post(/memo/)                    write_memo
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
    static ref MEMO_GET_REGEX: Regex = Regex::new(r"^/memo/(\d+)$").unwrap();
    static ref MEMO_GROUP_GET_REGEX: Regex = Regex::new(r"^/memogroup/(\d+)$").unwrap();
    static ref EXPLICIT_PERMISSIONS_REGEX: Regex = Regex::new(r"^/explicit_permissions/(\d+)$").unwrap();
    static ref FILE_UUID_REGEX: Regex = Regex::new(r"^/files/(?<uuid>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.").unwrap();
}

fn trim_trailing_slash(path: &str) -> &str {
    if path.ends_with('/') {
        &path[..path.len() - 1]
    } else {
        path
    }
}

/// All requests to the server are handled by this function.
pub async fn router(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    match (request.method(), trim_trailing_slash(request.uri().path())) {
        (&Method::GET, path) if MEMO_GET_REGEX.is_match(path) => get_memo(request).await,
        (&Method::POST, "/memo") => write_memo(request).await,
        (&Method::GET, "/memogroup") => get_memogroups_for_user(request).await,
        (&Method::GET, "/memo") => get_memo_titles(request).await,
        (&Method::POST, "/memo/search") => memo_search(request).await,
        (&Method::GET, "/file_auth") => file_auth(request).await,
        (&Method::GET, path) if EXPLICIT_PERMISSIONS_REGEX.is_match(path) => {
            get_explicit_permissions(&request).await
        }
        (&Method::PUT, "/upload") => upload_file(request).await,
        (&Method::GET, "/admin/files") => file_list(request).await,
        (&Method::GET, "/admin/memo_stats") => get_memo_stats(request).await,
        (&Method::GET, "/admin/all_user_groups") => get_all_usergroups(request).await,
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
async fn get_memo(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(&request).await?;

    let path = request.uri().path();
    let captures = MEMO_GET_REGEX.captures(path).unwrap();
    let memo_id = captures.get(1).unwrap().as_str().parse::<i32>()?;
    let memo: Result<Memo, _> = db::get_single(&client, &[&memo_id]).await;
    
    build_json_response(memo, requester)
}


fn split_and_trim(s: &str) -> (&str, &str) {
    let trimmed = s.trim_start();
    if let Some(pos) = trimmed.find('\n') {
        let (first_part, _second_part) = if pos > 0 && &trimmed[pos - 1..pos] == "\r" {
            trimmed.split_at(pos - 1)
        } else {
            trimmed.split_at(pos)
        };
        (first_part, &trimmed[pos..])
    } else {
        (trimmed, "")
    }
}

fn millis_since_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct WriteMemoForm {
    memo_id: i32,
    group_id: Option<i32>,
    text: String,
}
async fn write_memo(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let form: WriteMemoForm = parse_body(&mut request).await?;
    let (db_client, requester) = get_client_and_user(&request).await?;

    let (title, body) = split_and_trim(&form.text);
    let now = millis_since_epoch();

    trace!("Writing memo with id {} for {}: title:「{title}」, body:「{body}」, group_id: {:?}, now: {now}", form.memo_id, requester.username, form.group_id);
    let memo: Result<GetWriteMemo, PgError> = db::get_single(&db_client, &[&form.memo_id, &title, &body, &now, &form.group_id, &requester.username]).await;
    build_json_response(memo, requester)
}

#[utoipa::path(get, path="/memogroup",
    responses(
        (status=200, description="MemoGroup for current logged in user", body=Vec<MemoGroup>),
    ),
)]
async fn get_memogroups_for_user(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(&request).await?;

    let memo_group: Result<Vec<crate::model::MemoGroup>, _> =
        db::get_multiple(&client, &[&requester.username], Select).await;

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
    let captures = EXPLICIT_PERMISSIONS_REGEX.captures(path).unwrap();
    let memogroup_id = captures.get(1).unwrap().as_str().parse::<i32>()?;
    let permissions: Result<Vec<ExplicitPermission>, _> =
        db::get_multiple(&client, &[&memogroup_id, &requester.username], Select).await;

    build_json_response(permissions, requester)
}

#[utoipa::path(get, path="/memo/",
    responses(
        (status=200, description="Memo titles for current logged in user", body=MemoTitleList),
    ),
)]
async fn get_memo_titles(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(&request).await?;

    let memo_titles: Result<Vec<MemoTitle>, _> = db::get_multiple(&client, &[], Select).await;

    build_json_response(memo_titles, requester)
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct SearchMemoForm {
  search: String,
}

// TODO: Add swagger info
async fn memo_search(mut request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let form: SearchMemoForm = parse_body(&mut request).await?;
    let (client, requester) = get_client_and_user(&request).await?;
    let memo_titles: Result<Vec<MemoTitle>, _> = db::get_multiple(&client, &[&form.search], Search).await;

    build_json_response(memo_titles, requester)
}

// TODO: Add swagger info
async fn file_auth(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let (client, requester) = get_client_and_user(&request).await?;

    let uri = request.headers().get("X-Original-URI").unwrap().to_str().unwrap();
    debug!("Checking file auth for {uri}");
    let uuid = FILE_UUID_REGEX.captures(uri).unwrap().name("uuid").unwrap().as_str().parse::<uuid::Uuid>()?;

    let level: i32 = 1;
    let file_auth: Result<FilePermission, _> = db::get_single(&client, &[&uuid, &requester.username, &level]).await;
    trace!("File auth for {uri} is {:?}", file_auth);
    build_json_response(file_auth, requester)
}

#[derive(serde::Serialize, Debug)]
struct UploadResponse {
  filename: String,
  original_filename: String,
}

impl Named for UploadResponse {
  fn name() -> &'static str {
    "file"
  }
}

async fn upload_file(request: Request<Body>) ->Result<Response<Body>, GenericError> {
  let (client, requester) = get_client_and_user(&request).await?;
  let requester_name = requester.username.to_string();
  let requester = Requester { id: requester.id, username: &requester_name };

  let settings = &*SETTINGS;
  let fields = handle_multipart(request, &settings.file_storage.path).await?;


  debug!("Fields: {:?}", fields);

  let mut group_id = None;
  let mut generated_name = None;
  let mut original_filename = None;
  fields.into_iter().for_each(|field| {
    match field {
      Field::Regular(RegularField{name, value}) if name == "memo_group_id" => {
        group_id = value.parse::<i32>().ok();
      },
      Field::File(FileField{ upload_name, file_name }) => {
        generated_name = Some(file_name );
        original_filename = Some(upload_name);
      },
      _ => (),
    }
  });

  debug!("group_id: {:?}, generated_name: {:?}, original_filename: {:?}", group_id, generated_name, original_filename);
  if let (Some(memo_group_id), Some(generated_name), Some(original_filename)) = (group_id, generated_name, original_filename) {
    debug!("Save entry to filestore table");
    let uuid = generated_name[..generated_name.rfind('.').unwrap()].parse::<uuid::Uuid>().unwrap();
    match db::execute(&client, include_str!("sql/insert_filestore.sql"), &[&uuid, &requester.id, &original_filename, &memo_group_id, &millis_since_epoch()]).await {
      Ok(rows_inserted) => { 
        debug!("Number of rows inserted into filestore table: {}", rows_inserted);
        build_json_response(Ok(UploadResponse { filename: generated_name, original_filename }), requester)
      },
      Err(e) => { 
        error!("Something went wrong: {:?}", e); 
        "File not uploaded".to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR)
      },
    }
  } else {
     "File uploaded".to_text_response_with_status(StatusCode::BAD_REQUEST)
  }
}

#[derive(serde::Serialize)]
struct FilestoreResult<'a> {
  db_only: Vec<&'a FilestoreFileDB>,
  dir_only: Vec<FilestoreFile>,
}

impl Named for FilestoreResult<'_> {
  fn name() -> &'static str {
    "filestore"
  }
}

// TODO add swagger info
async fn file_list(request: Request<Body>) -> Result<Response<Body>, GenericError> {
  let (client, requester) = get_client_and_user(&request).await?;

  let files: Vec<FilestoreFileDB> = db::get_multiple(&client, &[], Select).await?;
  let files_in_dir = ls()?;
  let set: HashSet<&str> = files_in_dir.iter().map(|f| f.filename_no_extension()).collect();
  let db_only: Vec<&FilestoreFileDB> = files.iter().filter(|f| !set.contains(f.id.to_string().as_str())).collect();
  let db_set = files.iter().map(|f| f.id).collect::<HashSet<uuid::Uuid>>();
  let dir_only: Vec<FilestoreFile> = files_in_dir.into_iter()
    .filter(|f| 
      if let Ok(uuid) = &f.filename_no_extension().parse::<uuid::Uuid>() {
        !db_set.contains(uuid)
      } else {
        true
      }
      ).collect();

    build_json_response(Ok(FilestoreResult {db_only, dir_only} ), requester)
}

fn ls() -> Result<Vec<FilestoreFile>, GenericError> {
  let mut result = Vec::<FilestoreFile>::new();
  let settings = &*SETTINGS;
    let path = &settings.file_storage.path;
    let dir = std::fs::read_dir(path)?;
    for entry in dir {
        let entry = entry?;
        if entry.file_type()?.is_file() {
          result.push(FilestoreFile { filename: entry.file_name().to_string_lossy().to_string() });
        }
    }
    Ok(result)
}

// TODO add swagger
// TODO: add security
async fn get_memo_stats(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let client = set_admin_user(&request).await?;

    let json = db::get_json(&client, include_str!("sql/admin/memo_stats.sql"), &[]).await;
    build_simple_json_response(json)
}


// TODO add swagger
// TODO: add security
async fn get_all_usergroups(request: Request<Body>) -> Result<Response<Body>, GenericError> {
    let client = set_admin_user(&request).await?;

    let json = db::get_json(&client, include_str!("sql/admin/all_user_groups.sql"), &[]).await;
    build_simple_json_response(json)
}


/// Fetch the database connection and the current user from the request.
/// We set the current user in the postgres session in the connection
async fn get_client_and_user(
    request: &Request<Body>,
) -> Result<(deadpool_postgres::Client, Requester), GenericError> {
    let client = get_connection(request).await?;
    // get the current logged in user from the request
    let Some(user_identification) = request.extensions().get::<UserId>() else {
        return Err(GenericError::from("No user found in request, this should not happen"));
    };
    let username = &user_identification.0;

    // place the current user in the PostgreSQL session
    let set_var = client.prepare_cached(include_str!("sql/set_current_user.sql")).await?;
    let result = client.query_one(&set_var, &[&username]).await?;
    let user_id = result.get::<_, i32>(0);
    debug!("User id for {username} is {user_id}");

    Ok((client, Requester { id: user_id, username }))
}

async fn set_admin_user(request: &Request<Body>) -> Result<deadpool_postgres::Client, GenericError> {
    let client = get_connection(request).await?;
    let stmt = client.prepare_cached(include_str!("sql/admin/set_admin_user.sql")).await?;
    client.query_one(&stmt, &[]).await?;
    Ok(client)
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
    Err(e) => handle_pg_error_response(e),
  }
}

fn build_simple_json_response( data_result: Result<String, PgError>) -> Result<Response<Body>, GenericError> {
  match data_result {
    Ok(data) => data.to_string().to_json_response(),
    Err(e) => handle_pg_error_response(e),
  }
}

fn handle_pg_error_response(e: PgError) -> Result<Response<Body>, GenericError> {
    // Check if there's a SQLSTATE code
    if let Some(code) = e.code() {
        match code.code() {
            // Forbidden (permission denied)
            "2F004" | "42501" => // Added 42501 as another common permission code
                "Data access forbidden".to_text_response_with_status(StatusCode::FORBIDDEN),
            // Unauthorized (invalid credentials/authentication failure)
            "28P01" | "28000" => // Added 28P01 (invalid_password)
                "Data access unauthorized".to_text_response_with_status(StatusCode::UNAUTHORIZED),
            // No data found (returned by FETCH, SELECT INTO, etc.)
            "02000" =>
                "No data found".to_text_response_with_status(StatusCode::NOT_FOUND),
            // Default case for other known SQLSTATE codes - return generic server error
            _ => e.to_string().to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR),
        }
    } else {
        // Handle errors without a SQLSTATE code (e.g., connection errors)
        // Treat these as internal server errors as well
        e.to_string().to_text_response_with_status(StatusCode::INTERNAL_SERVER_ERROR)
    }
}

pub use swagger::swagger_json;
use utoipa::ToSchema;
mod swagger {
    use crate::model::{
        ExplicitPermission, GetWriteMemo, Memo, MemoGroup, MemoTitle, MemoTitleList, MemoUser, Requester, User
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
