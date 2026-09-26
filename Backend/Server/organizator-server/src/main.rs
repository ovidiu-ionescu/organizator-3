use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Form, Json};
use serde_json::json;
use axum_prometheus::PrometheusMetricLayer;

use axum::{Router, routing::get};
use lib_axum_organizator::app_error::AppError;
use lib_axum_organizator::declare_api_doc;
use lib_axum_organizator::postgres::{self, DbConn};
use lib_axum_organizator::security::authorization_middleware::{
    RequireAdmin, authorization_middleware,
};
use lib_axum_organizator::security::jot::{Jot, User};
use lib_axum_organizator::settings::Settings;
use lib_axum_organizator::state::AppState;
use lib_axum_organizator::typedef::{GenericError, HandlerResponse, SQLstr};
use lib_axum_organizator::utoipa_common::CommonError;
use mimalloc::MiMalloc;
use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use tracing::{debug, info, trace};
use tracing_subscriber::EnvFilter;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use utoipa_swagger_ui::SwaggerUi;

mod db;
mod memo_utils;
mod model;
mod response_utils;

use crate::db::QueryType::{Search, Select};
use crate::model::{
    ExplicitPermission, FilePermission, FilestoreFile, FilestoreFileDB, FilestoreResult,
    FilestoreResultWithRequester, GetWriteMemo, GetWriteMemoWithRequester, Memo,
    MemoGroupsWithRequester, MemoTitle, MemoTitleListWithRequester, MemoWithRequester, Requester,
    UploadResponse, UploadResponseWithRequester,
};
use crate::response_utils::{
    build_json_response, build_simple_json_response, millis_since_epoch, split_and_trim,
};

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[tokio::main]
async fn main() {
    //Setup tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let settings = Settings::new();

    let state = Arc::new(AppState {
        pool: postgres::make_database_pool(settings.postgres.clone()).await,
        jot: Jot::new(&settings.security).await.unwrap(),
        settings: settings.clone(),
    });

    declare_api_doc!();
    info!(
        "Start the metrics listener on {}",
        state.settings.metrics_ip()
    );
    let (prometheus_layer, metrics_handler) = PrometheusMetricLayer::pair();
    let metrics_router = Router::new().route(
        "/metrics",
        get(move || async move { metrics_handler.render() }),
    );
    let metrics_listener = tokio::net::TcpListener::bind(&state.settings.metrics_ip())
        .await
        .unwrap();
    info!(
        "Listening on {} for metrics",
        metrics_listener.local_addr().unwrap()
    );

    let (public_router, mut open_api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .with_state(state.clone())
        .split_for_parts();

    let upload_router = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(upload_handler))
        .route_layer(DefaultBodyLimit::max(512 * 1024 * 1024));

    let (protected_router, protected_api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(get_memo))
        .routes(routes!(write_memo))
        .routes(routes!(get_memogroups_for_user))
        .routes(routes!(get_memo_titles))
        .routes(routes!(memo_search))
        .routes(routes!(file_auth))
        .routes(routes!(get_explicit_permissions))
        .merge(upload_router)
        .routes(routes!(get_usergroups))
        .routes(routes!(create_user_group))
        .routes(routes!(rename_user_group))
        .routes(routes!(delete_user_group))
        .routes(routes!(add_user_group_member))
        .routes(routes!(remove_user_group_member))
        .routes(routes!(get_memogroups))
        .routes(routes!(create_memo_group))
        .routes(routes!(rename_memo_group))
        .routes(routes!(delete_memo_group))
        .routes(routes!(set_memo_group_access))
        .routes(routes!(revoke_memo_group_access))
        .routes(routes!(set_memo_group_public))
        .routes(routes!(file_list))
        .routes(routes!(get_memo_stats))
        .routes(routes!(get_all_usergroups))
        .with_state(state.clone())
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            authorization_middleware,
        ))
        .split_for_parts();

    // merge the specs
    open_api.merge(protected_api);
    let app = Router::new()
        .merge(public_router)
        .merge(protected_router)
        .fallback(not_found)
        .layer(prometheus_layer)
        .merge(SwaggerUi::new(settings.swagger_path).url("/api-docs/openapi.json", open_api));

    info!("Start the API listener on {}", state.settings.api_ip());
    let listener = tokio::net::TcpListener::bind(&state.settings.api_ip())
        .await
        .unwrap();
    info!("Listening on {} for API", listener.local_addr().unwrap());

    tokio::try_join!(
        axum::serve(metrics_listener, metrics_router),
        axum::serve(listener, app)
    )
    .unwrap();
}

async fn not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}

/// Get a memo by ID. The ID is passed as a path parameter.
#[utoipa::path(
    get,
    path = "/memo/{id}",
    responses(
        (status = 200, description = "Get memo by ID", body = MemoWithRequester),
        CommonError
    ),
    params(
        ("id" = i32, Path, description = "ID of the memo to retrieve")
    ),
    security(("bearer_auth" = []))
)]
async fn get_memo(
    Path(memo_id): Path<i32>,
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
) -> HandlerResponse {
    let memo: (Memo, Requester) = db::get_single(&db_client, requester.id(), &[&memo_id]).await?;

    build_json_response(memo)
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct WriteMemoForm {
    memo_id: Option<i32>,
    group_id: Option<i32>,
    text: String,
}

/// Write a memo to the database. The text is split into a title and body at the first newline
/// character.
#[utoipa::path(
    post,
    path = "/memo/",
    responses(
        (status = 200, description = "Write memo", body = GetWriteMemoWithRequester),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn write_memo(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    // last extractor consumes the body
    Form(form): Form<WriteMemoForm>,
) -> HandlerResponse {
    let (title, body) = split_and_trim(&form.text);
    let now = millis_since_epoch();
    let username = requester.id();

    debug!(
        "Writing memo with id {:?} for {}: title:「{title}」, body:「{body}」, group_id: {:?}, now: {now}",
        form.memo_id, username, form.group_id
    );
    let uuids = memo_utils::extract_uuids(&form.text);
    debug!(
        "Extracted {} UUIDs from memo text: {:?}",
        uuids.len(),
        uuids
    );
    let memo: (GetWriteMemo, Requester) = db::get_single(
        &db_client,
        username,
        &[
            &form.memo_id,
            &title,
            &body,
            &now,
            &form.group_id,
            &username,
            &uuids,
        ],
    )
    .await?;
    build_json_response(memo)
}

/// Get all memo groups for the current logged in user.
#[utoipa::path(get, path="/memogroup/",
    responses(
        (status=200, description="List of MemoGroup (id, name) for current logged in user", body=MemoGroupsWithRequester),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn get_memogroups_for_user(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
) -> HandlerResponse {
    trace!("Getting memo groups for user");
    let username = requester.id();

    let memo_group: (Vec<crate::model::MemoGroup>, Requester) =
        db::get_multiple(&db_client, username, &[&username], Select).await?;

    build_json_response(memo_group)
}

/// Get all memo titles for the current logged in user.
#[utoipa::path(get, path="/memo/",
    responses(
        (status=200, description="Memo titles for current logged in user", body=MemoTitleListWithRequester),
    ),
    security(("bearer_auth" = []))
)]
async fn get_memo_titles(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
) -> HandlerResponse {
    let username = requester.id();

    let memo_titles: (Vec<MemoTitle>, Requester) =
        db::get_multiple(&db_client, username, &[], Select).await?;

    build_json_response(memo_titles)
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct SearchMemoForm {
    #[schema(example = "test")]
    search: String,
}

/// Full text search for memos for the current logged in user.
#[utoipa::path(post, path="/memo/search",
    request_body(
        content = SearchMemoForm,
        content_type = "application/x-www-form-urlencoded",
        description = "Search string to search for in memos"
    ),
    responses(
        (status=200, description="List of memo titles", body=MemoTitleListWithRequester),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn memo_search(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Form(form): Form<SearchMemoForm>,
) -> HandlerResponse {
    let memo_titles: (Vec<MemoTitle>, Requester) =
        db::get_multiple(&db_client, requester.id(), &[&form.search], Search).await?;

    build_json_response(memo_titles)
}

static FILE_UUID_REGEX: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^/files/(?<uuid>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.").unwrap()
});

/// Get the file permissions for a given file UUID for the current logged in user.
/// The original path is passed in the header "X-Original-URI"
#[utoipa::path(
    get,
    path = "/file_auth",
    responses(
        (status = 200, description = "Get memo by ID", body = MemoWithRequester),
        CommonError
    ),
    params(
        ("X-Original-URI" = String, Header, description = "File to authorize", example = "/files/123e4567-e89b-12d3-a456-426614174000.txt"),
    ),
    security(("bearer_auth" = []))
)]
async fn file_auth(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    headers: HeaderMap,
) -> HandlerResponse {
    // Extract the UUID from the file name (strip extension if present)
    let original_uri = headers
        .get("X-Original-URI")
        .ok_or(AppError::from("Missing X-Original-URI header"))?
        .to_str()
        .map_err(|_| AppError::from("Invalid X-Original-URI header"))?;
    // FIXME: Get rid of unwrap() and handle the error properly
    let uuid = FILE_UUID_REGEX
        .captures(original_uri)
        .unwrap()
        .name("uuid")
        .unwrap()
        .as_str()
        .parse::<uuid::Uuid>()?;
    let level: i32 = 1;
    let file_auth: (FilePermission, Requester) = db::get_single(
        &db_client,
        requester.id(),
        &[&uuid, &requester.id(), &level],
    )
    .await?;
    trace!("File auth for {uuid} is {:?}", file_auth);
    build_json_response(file_auth)
}

/// Explicit permissions for a memogroup.
#[utoipa::path(get, path="/explicit_permissions/{id}",
    responses(
        (status=200, description="Explicit permissions for a memogroup", body=Vec<ExplicitPermission>),
    ),
    params(
        ("id" = i32, Path, description="MemoGroup id"),
    ),
)]
async fn get_explicit_permissions(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(memogroup_id): Path<i32>,
) -> HandlerResponse {
    let permissions: (Vec<ExplicitPermission>, Requester) = db::get_multiple(
        &db_client,
        requester.id(),
        &[&memogroup_id, &requester.id()],
        Select,
    )
    .await?;

    build_json_response(permissions)
}

/// Get all user groups for the current logged in user with full details.
#[utoipa::path(get, path="/usergroups",
    responses(
        (status=200, description="Usergroups for current user", body=Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn get_usergroups(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
) -> HandlerResponse {
    let json = db::get_json(
        &db_client,
        requester.id(),
        SQLstr(include_str!("sql/user_groups.sql")),
        &[],
    )
    .await?;
    build_simple_json_response(json)
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct AddMemberForm {
    username: String,
}

/// What `add_user_group_member.sql` reports about the insert it attempted.
#[derive(serde::Deserialize, Debug)]
struct AddMemberOutcome {
    /// `added`, `already_member`, `no_user` or `no_group`.
    outcome: String,
}

/// Add a user to one of the caller's own user groups.
///
/// The body names the member by username rather than by id: `/user-roles` is the only endpoint
/// that lists users and it is admin-only, so a username is the one identifier every caller has.
#[utoipa::path(
    post,
    path = "/usergroups/{id}/members",
    params(("id" = i32, Path, description = "user_group.id")),
    request_body = AddMemberForm,
    responses(
        (status = 200, description = "The user group with its members, as it is now", body = Object),
        (status = 403, description = "The group belongs to someone else", body = Object),
        (status = 404, description = "No such group, or not the caller's", body = Object),
        (status = 409, description = "That user is already a member", body = Object),
        (status = 422, description = "No user of that name", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn add_user_group_member(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(group_id): Path<i32>,
    // last extractor consumes the body
    Json(form): Json<AddMemberForm>,
) -> HandlerResponse {
    let member = form.username.trim();
    let username = requester.id();
    debug!("Adding 「{member}」 to user group {group_id} for {username}");

    let (outcome_json, _) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/add_user_group_member.sql")),
        &[&group_id, &member],
    )
    .await?;

    let outcome: AddMemberOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome != "added" {
        return Ok(match outcome.outcome.as_str() {
            "no_user" => refused(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("No user named 「{member}」"),
            ),
            "already_member" => refused(
                StatusCode::CONFLICT,
                format!("「{member}」 is already in this group"),
            ),
            // A group that is someone else's and a group that does not exist give the same
            // answer, so the ids of other people's groups cannot be probed.
            _ => refused(StatusCode::NOT_FOUND, "No such user group".to_string()),
        });
    }

    // A second statement, and deliberately not a second CTE: a data-modifying statement and
    // everything around it share one snapshot, so a SELECT in the statement that did the
    // INSERT cannot see the row it added. Reading the group here, after that transaction has
    // committed, is what makes the member list the caller gets back include the new member.
    let (group_json, group_requester) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/get_user_group.sql")),
        &[&group_id],
    )
    .await?;

    build_simple_json_response((group_json, group_requester))
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct NameForm {
    name: String,
}

/// What the group writes report. `outcome` is one of each endpoint's own set; the two payload
/// fields are present only where an endpoint has something extra to say.
#[derive(serde::Deserialize, Debug)]
struct GroupWriteOutcome {
    outcome: String,
    /// A user-group create builds this from the row it inserted.
    #[serde(default)]
    group: Option<serde_json::Value>,
    /// A memo-group create reports the id of what it made, and the handler reads it back.
    #[serde(default)]
    id: Option<i32>,
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct CreateMemoGroupForm {
    name: String,
    /// Only an admin is offered this; anyone else gets a group of their own either way.
    #[serde(default)]
    public: bool,
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct AccessForm {
    /// 1 for read, 2 for read and write. There is no level meaning "no access".
    access: i32,
}

#[derive(serde::Deserialize, Debug, Clone, ToSchema)]
struct PublicForm {
    public: bool,
}

/// Create a user group of the caller's own.
#[utoipa::path(
    post,
    path = "/usergroups",
    request_body = NameForm,
    responses(
        (status = 201, description = "The group that was created", body = Object),
        (status = 409, description = "The caller already has a group by that name", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn create_user_group(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    // last extractor consumes the body
    Json(form): Json<NameForm>,
) -> HandlerResponse {
    let name = form.name.trim();
    debug!("Creating user group 「{name}」 for {}", requester.id());

    if name.is_empty() {
        return Ok(refused(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A user group needs a name".to_string(),
        ));
    }

    let (outcome_json, _) = db::get_json(
        &db_client,
        requester.id(),
        SQLstr(include_str!("sql/create_user_group.sql")),
        &[&name],
    )
    .await?;

    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome != "created" {
        return Ok(refused(
            StatusCode::CONFLICT,
            format!("You already have a user group called 「{name}」"),
        ));
    }

    let group = outcome
        .group
        .ok_or_else(|| AppError::bad_request("The user group was created but not reported"))?;

    Ok((StatusCode::CREATED, Json(group)).into_response())
}

/// Rename one of the caller's own user groups.
#[utoipa::path(
    put,
    path = "/usergroups/{id}",
    params(("id" = i32, Path, description = "user_group.id")),
    request_body = NameForm,
    responses(
        (status = 200, description = "The user group with its members, as it is now", body = Object),
        (status = 404, description = "No such group, or not the caller's", body = Object),
        (status = 409, description = "The caller already has a group by that name", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn rename_user_group(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(group_id): Path<i32>,
    // last extractor consumes the body
    Json(form): Json<NameForm>,
) -> HandlerResponse {
    let name = form.name.trim();
    let username = requester.id();
    debug!("Renaming user group {group_id} to 「{name}」 for {username}");

    if name.is_empty() {
        return Ok(refused(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A user group needs a name".to_string(),
        ));
    }

    let (outcome_json, _) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/rename_user_group.sql")),
        &[&group_id, &name],
    )
    .await?;

    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome != "renamed" {
        return Ok(match outcome.outcome.as_str() {
            "name_taken" => refused(
                StatusCode::CONFLICT,
                format!("You already have a user group called 「{name}」"),
            ),
            _ => refused(StatusCode::NOT_FOUND, "No such user group".to_string()),
        });
    }

    let (group_json, group_requester) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/get_user_group.sql")),
        &[&group_id],
    )
    .await?;

    build_simple_json_response((group_json, group_requester))
}

/// Delete one of the caller's own user groups, and its members with it.
#[utoipa::path(
    delete,
    path = "/usergroups/{id}",
    params(("id" = i32, Path, description = "user_group.id")),
    responses(
        (status = 204, description = "Deleted, with its members and its access grants"),
        (status = 404, description = "No such group, or not the caller's", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn delete_user_group(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(group_id): Path<i32>,
) -> HandlerResponse {
    debug!("Deleting user group {group_id} for {}", requester.id());

    let (outcome_json, _) = db::get_json(
        &db_client,
        requester.id(),
        SQLstr(include_str!("sql/delete_user_group.sql")),
        &[&group_id],
    )
    .await?;

    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    match outcome.outcome.as_str() {
        // 204, with no body: the group is gone, and what it was granted on went with it by
        // the schema's own cascade.
        "removed" => Ok(StatusCode::NO_CONTENT.into_response()),
        _ => Ok(refused(StatusCode::NOT_FOUND, "No such user group".to_string())),
    }
}

/// Create a memo group of the caller's own, public if an admin asks for that.
#[utoipa::path(
    post,
    path = "/memogroups",
    request_body = CreateMemoGroupForm,
    responses(
        (status = 201, description = "The memo group that was created", body = Object),
        (status = 409, description = "The caller already has a memo group by that name", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn create_memo_group(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    // last extractor consumes the body
    Json(form): Json<CreateMemoGroupForm>,
) -> HandlerResponse {
    let name = form.name.trim();
    let username = requester.id();
    debug!(
        "Creating memo group 「{}」 (public: {}) for {}",
        name, form.public, username
    );

    if name.is_empty() {
        return Ok(refused(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A memo group needs a name".to_string(),
        ));
    }

    let (outcome_json, _) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/create_memo_group.sql")),
        &[&name, &form.public],
    )
    .await?;

    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome != "created" {
        return Ok(refused(
            StatusCode::CONFLICT,
            format!("You already have a memo group called 「{name}」"),
        ));
    }

    let group_id = outcome
        .id
        .ok_or_else(|| AppError::bad_request("The memo group was created but not reported"))?;

    let (group_json, _) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/get_memo_group.sql")),
        &[&group_id],
    )
    .await?;

    Ok((StatusCode::CREATED, build_json_body(group_json)?).into_response())
}

/// Rename one of the caller's own memo groups.
#[utoipa::path(
    put,
    path = "/memogroups/{id}",
    params(("id" = i32, Path, description = "memo_group.id")),
    request_body = NameForm,
    responses(
        (status = 200, description = "The memo group as it is now", body = Object),
        (status = 404, description = "No such group, or not the caller's", body = Object),
        (status = 409, description = "The caller already has a memo group by that name", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn rename_memo_group(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(group_id): Path<i32>,
    // last extractor consumes the body
    Json(form): Json<NameForm>,
) -> HandlerResponse {
    let name = form.name.trim();
    let username = requester.id();
    debug!("Renaming memo group {group_id} to 「{name}」 for {username}");

    if name.is_empty() {
        return Ok(refused(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A memo group needs a name".to_string(),
        ));
    }

    memo_group_write(
        &db_client,
        username,
        include_str!("sql/rename_memo_group.sql"),
        &[&group_id, &name],
        group_id,
        "renamed",
        &format!("You already have a memo group called 「{name}」"),
    )
    .await
}

/// Delete one of the caller's own memo groups, and its access grants with it.
#[utoipa::path(
    delete,
    path = "/memogroups/{id}",
    params(("id" = i32, Path, description = "memo_group.id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "No such group, or not the caller's", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn delete_memo_group(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(group_id): Path<i32>,
) -> HandlerResponse {
    debug!("Deleting memo group {group_id} for {}", requester.id());

    let (outcome_json, _) = db::get_json(
        &db_client,
        requester.id(),
        SQLstr(include_str!("sql/delete_memo_group.sql")),
        &[&group_id],
    )
    .await?;

    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome == "removed" {
        Ok(StatusCode::NO_CONTENT.into_response())
    } else {
        Ok(refused(StatusCode::NOT_FOUND, "No such memo group".to_string()))
    }
}

/// Give a user group access to a memo group, or change the access it has.
#[utoipa::path(
    put,
    path = "/memogroups/{id}/usergroups/{user_group_id}",
    params(
        ("id" = i32, Path, description = "memo_group.id"),
        ("user_group_id" = i32, Path, description = "user_group.id")
    ),
    request_body = AccessForm,
    responses(
        (status = 200, description = "The memo group as it is now", body = Object),
        (status = 400, description = "Access is neither 1 (read) nor 2 (read and write)", body = Object),
        (status = 404, description = "No such memo group or user group, or not the caller's", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn set_memo_group_access(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path((group_id, user_group_id)): Path<(i32, i32)>,
    // last extractor consumes the body
    Json(form): Json<AccessForm>,
) -> HandlerResponse {
    let username = requester.id();
    debug!(
        "Setting access {} for user group {user_group_id} on memo group {group_id}, for {username}",
        form.access
    );

    memo_group_write(
        &db_client,
        username,
        include_str!("sql/set_memo_group_access.sql"),
        &[&group_id, &user_group_id, &form.access],
        group_id,
        "granted",
        "Access is read (1) or read and write (2)",
    )
    .await
}

/// Take a user group's access to a memo group away.
#[utoipa::path(
    delete,
    path = "/memogroups/{id}/usergroups/{user_group_id}",
    params(
        ("id" = i32, Path, description = "memo_group.id"),
        ("user_group_id" = i32, Path, description = "user_group.id")
    ),
    responses(
        (status = 200, description = "The memo group as it is now", body = Object),
        (status = 404, description = "No such memo group, or not the caller's", body = Object),
        (status = 409, description = "That user group had no access to take away", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn revoke_memo_group_access(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path((group_id, user_group_id)): Path<(i32, i32)>,
) -> HandlerResponse {
    let username = requester.id();
    debug!("Revoking user group {user_group_id} on memo group {group_id}, for {username}");

    memo_group_write(
        &db_client,
        username,
        include_str!("sql/revoke_memo_group_access.sql"),
        &[&group_id, &user_group_id],
        group_id,
        "revoked",
        "That user group has no access to this memo group",
    )
    .await
}

/// Make a memo group visible to every user, or stop it being. An admin's alone.
#[utoipa::path(
    put,
    path = "/memogroups/{id}/public",
    params(("id" = i32, Path, description = "memo_group.id")),
    request_body = PublicForm,
    responses(
        (status = 200, description = "The memo group as it is now", body = Object),
        (status = 403, description = "Only an admin may publish a memo group", body = Object),
        (status = 404, description = "No such memo group", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn set_memo_group_public(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path(group_id): Path<i32>,
    // last extractor consumes the body
    Json(form): Json<PublicForm>,
) -> HandlerResponse {
    let username = requester.id();
    debug!(
        "Setting public={} on memo group {group_id}, for {username}",
        form.public
    );

    let (outcome_json, _) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/set_memo_group_public.sql")),
        &[&group_id, &form.public],
    )
    .await?;

    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    match outcome.outcome.as_str() {
        "changed" => {
            let (group_json, _) = db::get_json(
                &db_client,
                username,
                SQLstr(include_str!("sql/get_memo_group.sql")),
                &[&group_id],
            )
            .await?;
            Ok(build_json_body(group_json)?.into_response())
        }
        "not_admin" => Ok(refused(
            StatusCode::FORBIDDEN,
            "Only an administrator can make a memo group public".to_string(),
        )),
        _ => Ok(refused(
            StatusCode::NOT_FOUND,
            "No such memo group".to_string(),
        )),
    }
}

/// Runs a memo-group write and, if it succeeded, answers with the group as it now stands.
///
/// Every one of these writes has the same shape: one statement that decides what happened,
/// then a read of the group — in its own statement, because a data-modifying statement and
/// everything around it share one snapshot and could not see the change (add_user_group_member.sql).
/// `success` names the outcome that means it worked; anything else is refused with `conflict`,
/// which each caller words for the outcomes its own statement can produce.
async fn memo_group_write(
    db_client: &deadpool_postgres::Client,
    username: &str,
    query: &str,
    params: &[&(dyn tokio_postgres::types::ToSql + Sync)],
    group_id: i32,
    success: &str,
    conflict: &str,
) -> HandlerResponse {
    let (outcome_json, _) = db::get_json(db_client, username, SQLstr(query), params).await?;
    let outcome: GroupWriteOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome != success {
        let (status, message) = match outcome.outcome.as_str() {
            "name_taken" | "not_granted" => (StatusCode::CONFLICT, conflict.to_string()),
            "bad_access" => (StatusCode::BAD_REQUEST, conflict.to_string()),
            "no_user_group" => (
                StatusCode::NOT_FOUND,
                "No such user group, or not yours".to_string(),
            ),
            _ => (StatusCode::NOT_FOUND, "No such memo group".to_string()),
        };
        return Ok(refused(status, message));
    }

    let (group_json, _) = db::get_json(
        db_client,
        username,
        SQLstr(include_str!("sql/get_memo_group.sql")),
        &[&group_id],
    )
    .await?;

    Ok(build_json_body(group_json)?.into_response())
}

/// The JSON a group read produced, as a body. `db::get_json` hands back the text the database
/// built, so it is parsed to be embedded rather than sent as a JSON string.
fn build_json_body(json: String) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::from_str(&json)?))
}

/// Remove a user from one of the caller's own user groups.
///
/// The member is named by username, like the endpoint that adds one, and for the same reason.
#[utoipa::path(
    delete,
    path = "/usergroups/{id}/members/{username}",
    params(
        ("id" = i32, Path, description = "user_group.id"),
        ("username" = String, Path, description = "users.username of the member to remove")
    ),
    responses(
        (status = 200, description = "The user group with its members, as it is now", body = Object),
        (status = 404, description = "No such group, or not the caller's", body = Object),
        (status = 409, description = "That user is not a member", body = Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn remove_user_group_member(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    Path((group_id, member)): Path<(i32, String)>,
) -> HandlerResponse {
    let member = member.trim();
    let username = requester.id();
    debug!("Removing 「{member}」 from user group {group_id} for {username}");

    let (outcome_json, _) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/remove_user_group_member.sql")),
        &[&group_id, &member],
    )
    .await?;

    let outcome: AddMemberOutcome = serde_json::from_str(&outcome_json)?;

    if outcome.outcome != "removed" {
        return Ok(match outcome.outcome.as_str() {
            // Not a member covers a name that is real and a name that is not: telling those
            // two apart would be a way to ask which usernames exist.
            "not_member" => refused(
                StatusCode::CONFLICT,
                format!("「{member}」 is not in this group"),
            ),
            _ => refused(StatusCode::NOT_FOUND, "No such user group".to_string()),
        });
    }

    // A second statement, for the reason add_user_group_member gives: the DELETE and a SELECT
    // beside it share one snapshot, so only a read after the transaction commits shows the
    // member actually gone.
    let (group_json, group_requester) = db::get_json(
        &db_client,
        username,
        SQLstr(include_str!("sql/get_user_group.sql")),
        &[&group_id],
    )
    .await?;

    build_simple_json_response((group_json, group_requester))
}

/// A refusal the caller is meant to read, in the same `{"error": "..."}` shape `AppError`
/// answers in, so the app has one thing to parse whatever refused it.
fn refused(status: StatusCode, message: String) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Get all memo groups for the current logged in user with full details.
#[utoipa::path(get, path="/memogroups",
    responses(
        (status=200, description="Memogroups for current user", body=Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn get_memogroups(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
) -> HandlerResponse {
    let json = db::get_json(
        &db_client,
        requester.id(),
        SQLstr(include_str!("sql/memo_groups.sql")),
        &[],
    )
    .await?;
    build_simple_json_response(json)
}

/// Show the status of the file store, including files that are in the database but not on disk, and
/// files that are on disk but not in the database. This is an admin-only endpoint.
#[utoipa::path(get, path="/admin/files",
    responses(
        (status=200, description="File store status", body=FilestoreResultWithRequester),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn file_list(
    State(state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    _admin: RequireAdmin,
) -> HandlerResponse {
    let (files, requester) = db::get_multiple(&db_client, requester.id(), &[], Select).await?;
    let files_in_dir = ls(&state.settings.file_storage.path)?;
    let set: HashSet<&str> = files_in_dir
        .iter()
        .map(|f| f.filename_no_extension())
        .collect();
    let db_only: Vec<&FilestoreFileDB> = files
        .iter()
        .filter(|f: &&FilestoreFileDB| !set.contains(f.id.to_string().as_str()))
        .collect();
    let db_set = files.iter().map(|f| f.id).collect::<HashSet<uuid::Uuid>>();
    let dir_only: Vec<FilestoreFile> = files_in_dir
        .into_iter()
        .filter(|f| {
            if let Ok(uuid) = &f.filename_no_extension().parse::<uuid::Uuid>() {
                !db_set.contains(uuid)
            } else {
                true
            }
        })
        .collect();

    build_json_response((FilestoreResult { db_only, dir_only }, requester))
}

fn ls(path: &str) -> Result<Vec<FilestoreFile>, GenericError> {
    let mut result = Vec::<FilestoreFile>::new();
    let dir = std::fs::read_dir(path)?;
    for entry in dir {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            result.push(FilestoreFile {
                filename: entry.file_name().to_string_lossy().to_string(),
            });
        }
    }
    Ok(result)
}

/// Get memo statistics for the whole system. This is an admin-only endpoint.
#[utoipa::path(get, path="/admin/memo_stats",
    responses(
        (status=200, description="File store status", body=Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn get_memo_stats(
    State(_state): State<Arc<AppState>>,
    DbConn(db_client): DbConn,
    _admin: RequireAdmin,
) -> HandlerResponse {
    let json = db::get_json(
        &db_client,
        "admin",
        SQLstr(include_str!("sql/admin/memo_stats.sql")),
        &[],
    )
    .await?;
    build_simple_json_response(json)
}

/// Get all user groups for the whole system. This is an admin-only endpoint.
#[utoipa::path(get, path="/admin/all_user_groups",
    responses(
        (status=200, description="File store status", body=Object),
        CommonError
    ),
    security(("bearer_auth" = []))
)]
async fn get_all_usergroups(
    State(_state): State<Arc<AppState>>,
    DbConn(db_client): DbConn,
    _admin: RequireAdmin,
) -> HandlerResponse {
    let json = db::get_json(
        &db_client,
        "admin",
        SQLstr(include_str!("sql/admin/all_user_groups.sql")),
        &[],
    )
    .await?;
    build_simple_json_response(json)
}

use axum::extract::Multipart;
use std::path::Path as StdPath;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[utoipa::path(
    put,
    path = "/upload",
    tag = "files",
    request_body(
        content_type = "multipart/form-data"
    ),
    responses(
        (status = 201, description = "File uploaded successfully", body = UploadResponseWithRequester),
        (status = 400, description = "Missing file or invalid form field payload", body = String),
        (status = 500, description = "Failed to create directory or store file", body = String)
    )
)]
pub async fn upload_handler(
    State(state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(db_client): DbConn,
    mut multipart: Multipart,
) -> HandlerResponse {
    let mut memo_group_id: Option<i32> = None;
    let mut file_data: Option<(String, Uuid, String, String)> = None; // (original_name, saved_as, path)

    let upload_dir = &state.settings.file_storage.path;
    debug!("Ensure the upload directory exists");
    if let Err(err) = tokio::fs::create_dir_all(upload_dir).await {
        return Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Upload directory does not exist and failed to create it: {err}"),
        )
            .into_response());
    }

    while let Some(mut field) = multipart.next_field().await? {
        let name = field.name().unwrap_or("").to_string();

        if name == "memo_group_id" {
            let text = field
                .text()
                .await
                .map_err(|err| AppError::from(format!("Invalid text field: {err}")))?;

            if !text.trim().is_empty() {
                memo_group_id = text.trim().parse::<i32>().ok();
            }
        } else if field.file_name().is_some() {
            let original_name = field.file_name().unwrap().to_string();
            debug!("Original file name: 「{original_name}」");

            let extension = StdPath::new(&original_name)
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("");
            debug!("Extension: 「{extension}」");

            let uuid = Uuid::new_v4();
            let new_filename = if extension.is_empty() {
                uuid.to_string()
            } else {
                format!("{uuid}.{extension}")
            };

            let file_path = StdPath::new(upload_dir).join(&new_filename);

            let mut file = File::create(&file_path)
                .await
                .map_err(|err| AppError::from(format!("Failed to create file: {err}")))?;

            debug!("Start reading the file data");
            while let Some(chunk) = field.chunk().await? {
                // pass explicit slice reference to write_all to help the compiler infer the correct
                // type
                file.write_all(&chunk[..])
                    .await
                    .map_err(|err| AppError::from(format!("Failed to write to file: {err}")))?;
            }

            file_data = Some((
                original_name,
                uuid,
                new_filename,
                file_path.to_string_lossy().into_owned(),
            ));
        }
    }

    // Ensure a file was actually processed
    let (original_filename, uuid, saved_as, _path) =
        file_data.ok_or_else(|| AppError::bad_request("No file found in request body"))?;

    let (rows_inserted, requester) = db::execute(
        &db_client,
        requester.id(),
        include_str!("sql/insert_filestore.sql"),
        &[
            &uuid,
            &original_filename,
            &memo_group_id,
            &millis_since_epoch(),
        ],
    )
    .await?;
    debug!(
        "Number of rows inserted into filestore table: {}",
        rows_inserted
    );
    build_json_response((
        UploadResponse {
            filename: saved_as,
            original_filename,
        },
        requester,
    ))
}
