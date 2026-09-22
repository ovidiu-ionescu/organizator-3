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
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tracing_subscriber::EnvFilter;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use utoipa_swagger_ui::SwaggerUi;

use tracing::{error, info, warn};

use crate::db::{Login, Role, fetch_login};
use crate::login_throttle::LoginThrottle;

mod db;
mod login_throttle;

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
        .routes(routes!(me_handler))
        .routes(routes!(update_password_handler))
        .routes(routes!(get_user_roles, put_user_roles))
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

/// Wrong passwords are counted for this process, which is the scope that matters while a single
/// binary serves the login route. See login_throttle.rs for what it does and what it does not.
static LOGIN_THROTTLE: LazyLock<LoginThrottle> = LazyLock::new(LoginThrottle::new);

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
        (status = 400, description = "Malformed form submission"),
        (status = 429, description = "Too many wrong passwords for this username; the Retry-After header says how long to wait")
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

    if form.username.is_empty() {
        error!("Username is empty");
        return Ok((StatusCode::BAD_REQUEST, "Username is empty").into_response());
    }

    // Checked before the password is verified and before a database connection is taken, so a
    // caller who is being made to wait learns nothing from the attempt and cannot use it to burn
    // the pool. Note this also means a failure during a wait does not extend the wait.
    let wait_left = LOGIN_THROTTLE.wait_left(&form.username);
    if wait_left > Duration::ZERO {
        warn!(
            "Login for 「{}」 refused, {}s left to wait",
            form.username,
            wait_left.as_secs()
        );
        return Ok((
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, wait_left.as_secs().to_string())],
            "Too many failed attempts, try again later",
        )
            .into_response());
    }

    let client = state.pool.get().await.expect("Failed to get DB client");
    let login = fetch_login(&client, &form.username).await?;
    if !verify_password(&form.password, &login) {
        let wait = LOGIN_THROTTLE.record_failure(&form.username);
        warn!(
            "Bad password for 「{}」{}",
            form.username,
            match wait {
                Duration::ZERO => String::new(),
                wait => format!(", next attempt in {}s", wait.as_secs()),
            }
        );
        return Ok((StatusCode::UNAUTHORIZED, "Bad password").into_response());
    }
    LOGIN_THROTTLE.record_success(&form.username);

    let roles = db::get_roles_for_user(&client, &form.username).await?;
    // the token carries the names only; the descriptions are for the API to hand out, not the JWT
    let temp: Vec<&str> = roles.iter().map(|role| role.name.as_str()).collect();
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

/// The shortest new password accepted. Length is what actually resists guessing: character-class
/// rules rarely add entropy, because they push everyone towards the same shapes (Password1!) and
/// towards reuse. Ten is the floor asked for here; longer would be better.
const MIN_PASSWORD_LENGTH: usize = 10;

/// Common passwords that are at least MIN_PASSWORD_LENGTH long, lower case, one per line, compiled
/// into the binary like the SQL is. See the header of that file for its source and what was
/// dropped. Shorter entries are left out on purpose: the length rule already rejects those, so
/// keeping them would only grow the binary.
static COMMON_PASSWORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    include_str!("data/common-passwords.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect()
});

/// Why this new password is too easy to guess, or None when it is acceptable.
///
/// The comparisons are case-insensitive on purpose: Password123 is no less common than password123,
/// and `admin2026` is no better than `Admin2026`. Nothing is trimmed — a leading or trailing space
/// is a legitimate part of a password, and silently ignoring it would store something other than
/// what was typed.
fn password_problem(password: &str, username: &str) -> Option<String> {
    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Some(format!(
            "New password must be at least {MIN_PASSWORD_LENGTH} characters"
        ));
    }

    let lowered = password.to_lowercase();
    if COMMON_PASSWORDS.contains(lowered.as_str()) {
        return Some("That password is one of the most commonly used ones".to_string());
    }
    if !username.is_empty() && lowered.contains(&username.to_lowercase()) {
        return Some("New password must not contain the username".to_string());
    }

    None
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
        (status = 400, description = "Bad old password"),
        (status = 403, description = "Forbidden: You are not allowed to change this user's password"),
        (status = 422, description = "The new password was refused: too short, one of the most commonly used, or it contains the username"),
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
        return Ok((StatusCode::BAD_REQUEST, "Bad old password").into_response());
    }

    // use the form username if supplied and not empty, otherwise use the requester
    let username = match form.username {
        Some(ref username) if !username.is_empty() => username,
        _ => requester_name,
    };
    // let's check if the requester is allowed to change the password for the username.
    // The users table enforces this again per row with its update_policy, which admits only the
    // row matching organizator.current_user — or any row when that is id 1, which is the database's
    // idea of the admin and not the same as is_admin() below.
    if username != requester_name && !requester.is_admin() {
        return Ok((
            StatusCode::FORBIDDEN,
            "You are not allowed to change this user's password",
        )
            .into_response());
    }

    // Refused only once the caller has proven who they are and that they may touch this user, so a
    // failure there is reported instead of a complaint about the new password. 422 rather than 400
    // because 400 already means "bad old password", and a client should not have to tell two
    // failures apart by reading a body. This also covers an empty password, which would otherwise
    // hash and store happily and then verify against an empty string at login.
    if let Some(problem) = password_problem(&form.new_password, username) {
        return Ok((StatusCode::UNPROCESSABLE_ENTITY, problem).into_response());
    }

    // compute the new password hash and salt
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(form.new_password.as_bytes(), &salt)?
        .to_string();
    db::update_password(&client, requester_name, username, &password_hash).await?;
    info!("User 「{requester_name}」 updated password for 「{username}」");
    Ok(("Password updated").into_response())
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    /// The name the caller signed in with, which is what /password takes as `username`.
    name: String,
    /// The same test /user-roles and /roles make before letting the caller through.
    is_admin: bool,
    /// What the caller may reach, which is the one part of the user list a non-admin still gets to
    /// see: their own roles, so they can tell which systems they have access to.
    roles: Vec<Role>,
}

/// Who the caller is, so a client can tell what to show them: the whole user list for an admin,
/// and only the caller's own roles and password form for anybody else.
#[utoipa::path(
    get,
    path = "/me",
    responses(
        (status = 200, description = "The caller's name, whether they are an admin, and their roles", body = MeResponse),
        (status = 401, description = "Invalid credentials"),
    ),
    security(
        ("bearer_auth" = [])
    ),
    tag = "Me",
)]
#[axum::debug_handler]
async fn me_handler(
    State(state): State<Arc<AppState>>,
    Extension(requester): Extension<User>,
) -> Result<Json<MeResponse>, AppError> {
    let client = state.pool.get().await.expect("Failed to get DB client");
    let roles = db::get_roles_for_user(&client, &requester.id()).await?;
    let is_admin = requester.is_admin();
    Ok(Json(MeResponse {
        name: requester.into_id(),
        is_admin,
        roles,
    }))
}

/// Get all the users and their individual roles
#[utoipa::path(
    get,
    path = "/user-roles",
    responses(
        (
            status = 200, 
            description = "",
            body = Object,
            example = json!([
              {
                "id": 1,
                "name": "admin",
                "roles": [
                  {
                    "id": 1,
                    "name": "orgadm",
                    "description": "Organizator administrator"
                  },
                  {
                    "id": 2,
                    "name": "org",
                    "description": "Organizator user"
                  },
                  {
                    "id": 3,
                    "name": "photo",
                    "description": "Access to photos"
                  }
                ]
              },
              {
                "id": 2,
                "name": "user",
                "roles": [
                  {
                    "id": 2,
                    "name": "org",
                    "description": "Organizator user"
                  },
                  {
                    "id": 3,
                    "name": "photo",
                    "description": "Access to photos"
                  }
                ]
              },
              {
                "id": 3,
                "name": "guest",
                "roles": [
                  {
                    "id": 2,
                    "name": "org",
                    "description": "Organizator user"
                  },
                  {
                    "id": 3,
                    "name": "photo",
                    "description": "Access to photos"
                  }
                ]
              }
            ]
            )
        ),
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

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct UserRoleUpdate {
    user_id: i64,
    role_ids: Vec<i64>,
}

#[utoipa::path(
    put,
    path = "/user-roles",
    security(
        ("bearer_auth" = [])
    ),
    request_body = Vec<UserRoleUpdate>,
    responses(
        (status = 204, description = "Roles updated successfully"),
        (status = 500, description = "Database error")
    ),
    tag = "UserRoles",
)]
#[axum::debug_handler]
async fn put_user_roles(
    State(state): State<Arc<AppState>>,
    _admin: RequireAdmin,
    Json(payload): Json<Vec<UserRoleUpdate>>,
) -> HandlerResponse {
  // Collect distinct user IDs being targeted
    let target_user_ids: Vec<i64> = payload.iter().map(|u| u.user_id).collect();

    // Flatten user_id and role_id pairs into parallel vectors for UNNEST
    let mut flat_user_ids: Vec<i64> = Vec::new();
    let mut flat_role_ids: Vec<i64> = Vec::new();

    for update in &payload {
        for &role_id in &update.role_ids {
            flat_user_ids.push(update.user_id);
            flat_role_ids.push(role_id);
        }
    }
    let client = state.pool.get().await.expect("Failed to get DB client");
    client.execute(
        include_str!("sql/put_users_and_roles.sql"),
        &[&target_user_ids, &flat_user_ids, &flat_role_ids]
    ).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Get all roles
#[utoipa::path(
    get,
    path = "/roles",
    responses(
        (
            status = 200, 
            description = "",
            body = Object,
            example = json!([
                {
                  "id": 1,
                  "name": "orgadm",
                  "description": "Organizator administrator",
                  "created_at": "2026-09-06T05:39:45.367601+00:00"
                },
                {
                  "id": 2,
                  "name": "org",
                  "description": "Organizator user",
                  "created_at": "2026-09-06T05:39:45.367601+00:00"
                },
                {
                  "id": 3,
                  "name": "photo",
                  "description": "Access to photos",
                  "created_at": "2026-09-06T05:39:45.367601+00:00"
                }
              ]
            )
        ),
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


#[cfg(test)]
mod password_policy_tests {
    use super::*;

    #[test]
    fn the_common_list_is_actually_loaded() {
        // Guards the include_str! and the parser together: a wrong path fails the build, but a
        // parser that quietly skipped everything would not.
        assert!(
            COMMON_PASSWORDS.len() > 9_000,
            "expected the list to be loaded, got {} entries",
            COMMON_PASSWORDS.len()
        );
        assert!(COMMON_PASSWORDS.contains("password123"));
        assert!(COMMON_PASSWORDS.contains("1234567890"));
    }

    #[test]
    fn short_passwords_are_refused() {
        for password in ["", "short", "ninechars"] {
            assert!(
                password_problem(password, "admin").is_some(),
                "{password:?} should have been refused"
            );
        }
        assert!(password_problem("tencharsxx", "admin").is_none());
    }

    #[test]
    fn common_passwords_are_refused_whatever_the_case() {
        for password in ["password123", "PASSWORD123", "Password123", "1234567890"] {
            assert!(
                password_problem(password, "admin").is_some(),
                "{password:?} should have been refused"
            );
        }
    }

    #[test]
    fn a_password_containing_the_username_is_refused() {
        for password in ["admin2026!", "Admin2026!", "the-admin-2026"] {
            assert!(
                password_problem(password, "admin").is_some(),
                "{password:?} should have been refused"
            );
        }
        // a different user's name is not this user's problem
        assert!(password_problem("admin2026!", "someone").is_none());
    }

    #[test]
    fn an_ordinary_password_is_accepted() {
        for password in ["correct-horse-battery", "Tr0ub4dor & 3", "a long passphrase here"] {
            assert!(
                password_problem(password, "admin").is_none(),
                "{password:?} should have been accepted"
            );
        }
    }
}
