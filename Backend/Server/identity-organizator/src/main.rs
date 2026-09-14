use argon2::PasswordHasher;
use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::routing::get;
use axum::{Extension, Form, Json};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordVerifier},
};
use axum::Router;
use axum::response::{IntoResponse, Response};
use axum_prometheus::PrometheusMetricLayer;
use lib_axum_organizator::app_error::AppError;
use lib_axum_organizator::axum_response_utils::build_axum_json_response;
use lib_axum_organizator::declare_api_doc;
use lib_axum_organizator::postgres::{self, DbConn};
use lib_axum_organizator::security::authorization_middleware::{
    RequireAdmin, authorization_middleware,
};
use lib_axum_organizator::security::check_security::{create_security_cookie, extract_jwt};
use lib_axum_organizator::security::jot::{Jot, PublicKey, User};
use lib_axum_organizator::settings::Settings;
use lib_axum_organizator::state::AppState;
use lib_axum_organizator::typedef::{HandlerResponse, SQLstr};
use mimalloc::MiMalloc;
use serde::Deserialize;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use utoipa_swagger_ui::SwaggerUi;

use tracing::{error, info, warn};

use crate::db::{Login, fetch_login};

mod db;

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
        .routes(routes!(public_key_handler))
        .routes(routes!(login_handler))
        .with_state(state.clone())
        .split_for_parts();

    let (protected_router, protected_api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(refresh_token_handler))
        .routes(routes!(logout_handler))
        .routes(routes!(update_password_handler))
        .routes(routes!(get_user_roles))
        .routes(routes!(get_all_roles))
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

/// This endpoint returns the public key used to verify JWT tokens. It is a public endpoint and does
/// not require authentication.
#[utoipa::path(
    get,
    path = "/public",
    responses(
        (status = 200, description = "Public key retrieved successfully", body = PublicKey),
        (status = 500, description = "Failed to retrieve public key")
    ),
    tag = "PublicKey"
)]
async fn public_key_handler(State(state): State<Arc<AppState>>) -> Json<PublicKey> {
    info!("Received request for public key");
    Json(state.jot.get_public_key())
}

/// Refresh the JWT token. This endpoint requires a valid JWT token in the Authorization header.
/// The new token will be returned in the response body and also set as a cookie in the response
/// headers.
#[utoipa::path(
    get,
    path = "/refresh",
    params(
        ("x-organizator-client-version" = Option<String>, Header, description = "Optional header to indicate the client. 
         If present, the server will not return the JWT token in the response body.")
    ),
    responses(
        (status = 200, description = "Public key retrieved successfully", body = String),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Failed to retrieve public key")
    ),
    security(("bearer_auth" = [])),
    tag = "RefreshToken"
)]
async fn refresh_token_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    info!("Received request to refresh token");
    let Some(token) = extract_jwt(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            "No Authorization header".to_string(),
        );
    };
    let jot = &state.jot;

    match jot.refresh_token(token) {
        Ok(new_token) => {
            info!("Token refreshed successfully");
            (StatusCode::OK, new_token.clone())
        }
        Err(e) => {
            error!("Failed to refresh token: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to refresh token".to_string(),
            )
        }
    }
}

#[derive(Deserialize, ToSchema)]
struct LoginForm {
    /// Enter your username. It will be used to look up the user in the database.
    #[schema(example = "")]
    username: String,
    /// Enter your password. It will be hashed and compared to the stored hash in the database.
    #[schema(format = "password", example = "")]
    password: String,
}

#[utoipa::path(
    post,
    path = "/login",
    params(
        ("x-organizator-client-version" = Option<String>, Header, description = "Optional header to indicate the client. 
         If present, the server will not return the JWT token in the response body.")
    ),
    request_body(
        content = LoginForm,
        content_type = "application/x-www-form-urlencoded",
        description = "User login credentials submitted via form"
    ),
    responses(
        (status = 200, description = "Login successful"),
        (status = 401, description = "Invalid credentials"),
        (status = 400, description = "Malformed form submission")
    ),
    tag = "Authentication"
)]
async fn login_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    // last extractor consumes the body
    Form(form): Form<LoginForm>,
) -> Result<Response, AppError> {
    info!("Received login request for username: {}", form.username);
    let client = state.pool.get().await.expect("Failed to get DB client");

    if form.username.is_empty() {
        error!("Username is empty");
        return Ok((StatusCode::BAD_REQUEST, "Username is empty").into_response());
    }
    let login = fetch_login(&client, &form.username).await?;
    if !verify_password(&form.password, &login) {
        return Ok((StatusCode::UNAUTHORIZED, "Bad password").into_response());
    }

    let roles = db::get_roles_for_user(&client, &form.username).await?;
    let temp: Vec<&str> = roles.iter().map(|s| s.as_str()).collect();
    let new_token: String = state.jot.generate_token(&form.username, &temp)?;
    info!("User 「{}」 logged in", &form.username);
    let cookie = create_security_cookie(&new_token);

    // if it has the web client header, return just the cookie
    Ok(if headers.get("x-organizator-client-version").is_some() {
        (
            StatusCode::NO_CONTENT,
            [
                (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                (header::SET_COOKIE, &cookie),
                (header::SERVER, "hyper"),
            ],
            "",
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                (header::SET_COOKIE, &cookie),
                (header::SERVER, "hyper"),
            ],
            new_token,
        )
            .into_response()
    })
}

pub fn verify_password(password: &str, login: &Login) -> bool {
    if let Some(password_hash_string) = &login.password_hash {
        // parse the password hash string into a PasswordHash struct
        let password_hash = match PasswordHash::new(password_hash_string) {
            Ok(hash) => hash,
            Err(e) => {
                error!(
                    "Failed to parse password hash for user 「{:?}」: {:?}",
                    login.username, e
                );
                return false;
            }
        };
        let ok = Argon2::default()
            .verify_password(password.as_bytes(), &password_hash)
            .is_ok();
        if ok {
            info!("Password for user 「{:?}」is correct", login.username);
        } else {
            warn!(
                "Password hash found for user 「{:?}」 but password is incorrect",
                login.username
            );
        }
        ok
    } else {
        warn!("No password hash found for user 「{:?}」", login.username);
        false
    }
}

/// there is no real logout but for a browser client, we can clear the cookie by setting it to empty
/// and max-age=0
#[utoipa::path(
    get,
    path = "/logout",
    security(("bearer_auth" = [])),
    tag = "Logout"
)]
async fn logout_handler() -> impl IntoResponse {
    info!("Received request to logout");
    let cookie = "__Host-jwt=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0;".to_string();
    (
        StatusCode::NO_CONTENT,
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::SET_COOKIE, &cookie),
            (header::SERVER, "axum"),
        ],
        "",
    )
        .into_response()
}

#[derive(Deserialize, Debug, Clone, ToSchema)]
struct ChangePasswordForm {
    /// Only required if admin is changing another user's password.
    #[schema(example = "")]
    username: Option<String>,
    /// Your old password.
    #[schema(format = "password", example = "")]
    old_password: String,
    /// New user password. It will be hashed and stored in the database.
    #[schema(format = "password", example = "")]
    new_password: String,
}

/// You can change your own password or if you are the admin, you can change anyone's password.
#[utoipa::path(
    post,
    path = "/password",
    request_body(
        content = ChangePasswordForm,
        content_type = "application/x-www-form-urlencoded",
        description = "Form submission for changing a user's password. The requester must provide their old password and the new password. If the requester is an admin, they can change any user's password by providing the username."
    ),
    responses(
        (status = 200, description = "Password updated successfully"),
        (status = 401, description = "Invalid credentials"),
        (status = 403, description = "Forbidden: You are not allowed to change this user's password"),
    ),
    security(
        ("bearer_auth" = [])
    ),
    tag = "ChangePassword",
)]
#[axum::debug_handler]
async fn update_password_handler(
    State(_state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
    DbConn(client): DbConn,
    Form(form): Form<ChangePasswordForm>,
) -> Result<Response, AppError> {
    //let client = state.pool.get().await.expect("Failed to get DB client");
    let requester_name = &requester.id.0;

    // check the old password was correctly supplied
    // old password is the requester's password
    let login = fetch_login(&client, requester_name).await?;
    if !verify_password(&form.old_password, &login) {
        return Ok((StatusCode::UNAUTHORIZED, "Bad old password").into_response());
    }

    // compute the new password hash and salt
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(form.new_password.as_bytes(), &salt)?
        .to_string();

    // use the form username if supplied and not empty, otherwise use the requester
    let username = match form.username {
        Some(ref username) if !username.is_empty() => username,
        _ => requester_name,
    };
    // let's check if the requester is allowed to change the password for the username
    // at this point, there is no row security in for table users
    if username != requester_name && !requester.is_admin() {
        return Ok((
            StatusCode::FORBIDDEN,
            "You are not allowed to change this user's password",
        )
            .into_response());
    }
    db::update_password(&client, requester_name, username, &password_hash).await?;
    info!("User 「{requester_name}」 updated password for 「{username}」");
    Ok(("Password updated").into_response())
}

/// Get all the users and their individual roles
#[utoipa::path(
    get,
    path = "/user-roles",
    responses(
        (status = 200, description = ""),
        (status = 401, description = "Invalid credentials"),
        (status = 403, description = "You need to be an admin to access this endpoint"),
    ),
    security(
        ("bearer_auth" = [])
    ),
    tag = "UserRoles",
)]
#[axum::debug_handler]
async fn get_user_roles(
    State(state): State<Arc<AppState>>,
    _admin: RequireAdmin,
) -> HandlerResponse {
    let client = state.pool.get().await.expect("Failed to get DB client");
    let json = db::get_json_query(
        &client,
        SQLstr(include_str!("sql/get_users_and_roles.sql")),
        &[],
    )
    .await?;
    build_axum_json_response(json)
}

/// Get all roles
#[utoipa::path(
    get,
    path = "/roles",
    responses(
        (status = 200, description = ""),
        (status = 401, description = "Invalid credentials"),
        (status = 403, description = "You need to be an admin to access this endpoint"),
    ),
    security(
        ("bearer_auth" = [])
    ),
    tag = "UserRoles",
)]
#[axum::debug_handler]
async fn get_all_roles(
    State(state): State<Arc<AppState>>,
    _admin: RequireAdmin,
) -> HandlerResponse {
    let client = state.pool.get().await.expect("Failed to get DB client");
    let json = db::get_json_query(
        &client,
        SQLstr(include_str!("sql/get_all_roles.sql")),
        &[],
    )
    .await?;
    build_axum_json_response(json)
}

