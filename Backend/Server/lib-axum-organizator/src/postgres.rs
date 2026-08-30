use std::ops::Deref;

use crate::settings::PostgresConfig;
use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use deadpool_postgres::Object;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use tokio_postgres::NoTls;
use tracing::{debug, error, info, warn};
use tokio_postgres::Error as PgError;
use std::error::Error;

pub async fn make_database_pool(postgres: PostgresConfig) -> Pool {
    let config = Config {
        host: Some(postgres.host),
        port: Some(postgres.port),
        user: Some(postgres.user),
        password: Some(postgres.password),
        dbname: Some(postgres.dbname),
        application_name: Some(postgres.application_name),
        manager: Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        }),
        ..Default::default()
    };
    let pool = config.create_pool(Some(Runtime::Tokio1), NoTls).unwrap();
    // check we can connect to the Database, we abort if we can't
    match pool.get().await {
        Ok(_) => info!("Connected to database"),
        Err(e) => panic!("Failed to connect to database: {e},\nusing config: {config:#?}"),
    }

    pool
}

// Define a trait the app state must implement
pub trait HasPool {
    fn pool(&self) -> &Pool;
}

// Define a wrapper struct around the client connection
pub struct DbConn(pub Object);

// Implement FromRequestParts for your wrapper
impl<S> FromRequestParts<S> for DbConn
where
    S: Deref + Send + Sync,
    S::Target: HasPool,
{
    type Rejection = DbError;

    async fn from_request_parts(_parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // Acquire connection asynchronously
        let client = state.pool().get().await.map_err(|err| {
            tracing::error!("Failed to acquire DB connection: {err}");
            DbError::PoolExhausted
        })?;

        Ok(DbConn(client))
    }
}

// 3. Define a custom error type so Axum knows how to respond if connection fails
pub enum DbError {
    PoolExhausted,
}

impl IntoResponse for DbError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal database error").into_response()
    }
}

pub fn handle_pg_error_response(e: &PgError) -> impl IntoResponse {
    if let Some(cause) = e.source() {
        error!("{}", cause);
    }
    if let Some((db_err, where_ctx)) = e.as_db_error().map(|e| (e, e.where_())) {
        error!("Message: {} | Where: {:?}", db_err.message(), where_ctx);
    }
    debug!("check if there's an SQLSTATE code {:#?}", e);
    if let Some(code) = e.code() {
        match code.code() {
            // Forbidden (permission denied)
            "2F004" | "42501" | "2F002" =>
            // Added 42501 as another common permission code
            {
                (StatusCode::FORBIDDEN, "Data access forbidden".to_string())
            }
            // Unauthorized (invalid credentials/authentication failure)
            "28P01" | "28000" =>
            // Added 28P01 (invalid_password)
            {
                (
                    StatusCode::UNAUTHORIZED,
                    "Data access unauthorized".to_string(),
                )
            }
            // No data found (returned by FETCH, SELECT INTO, etc.)
            "02000" => (StatusCode::NOT_FOUND, "No data found".to_string()),
            // Default case for other known SQLSTATE codes - return generic server error
            _ => {
                warn!(
                    "Unhandled SQLSTATE code: {}, treating as internal server error",
                    code.code()
                );
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        }
    } else {
        // Handle errors without a SQLSTATE code (e.g., connection errors)
        // Treat these as internal server errors as well
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    }
}


