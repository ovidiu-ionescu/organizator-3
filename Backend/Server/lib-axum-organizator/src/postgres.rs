use std::ops::Deref;

use crate::settings::PostgresConfig;
use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use deadpool_postgres::Object;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use std::error::Error;
use tokio_postgres::Error as PgError;
use tokio_postgres::NoTls;
use tracing::{debug, error, info, warn};

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
            // Permission denied. Most of these are raised deliberately by SQL/ when a user is not
            // allowed to touch a memo, a group or another user's password: 2F002
            // (modifying_sql_data_not_permitted), 2F004 (reading_sql_data_not_permitted). 42501
            // (insufficient_privilege) is raised nowhere in SQL/, so it does come from Postgres
            // itself and does mean a missing privilege — the message logged above tells the two
            // apart. Logged at error level because a denial that is answered and then forgotten is
            // exactly the one nobody notices going wrong.
            "2F002" | "2F004" | "42501" => {
                error!(
                    "SQLSTATE {} denied by the database; answering 403. The message logged above says whether our own SQL raised it or a privilege is missing",
                    code.code()
                );
                (StatusCode::FORBIDDEN, "Data access forbidden".to_string())
            }
            // invalid_password: Postgres refused the service's OWN credentials. That is a server
            // fault, not a client one — answering 401 would tell every client to authenticate
            // again, and their login would fail too, because it hits the same credentials. Unlike
            // 28000 this code appears nowhere in SQL/, so there is no ambiguity about its source.
            "28P01" => {
                error!(
                    "Database rejected the service's own credentials (SQLSTATE {}); answering 500 rather than 401",
                    code.code()
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our end.".to_string(),
                )
            }
            // invalid_authorization_specification, but not from the connection: SQL/ raises this
            // one on purpose in six files to mean "the requester did not resolve to exactly one
            // user" (get_user_by_name, set_current_user, memo_read, memo_write, ...). That is a
            // client-facing failure of the caller's own identity, so it keeps its 401 and the
            // usual re-authenticate path.
            "28000" => (
                StatusCode::UNAUTHORIZED,
                "Data access unauthorized".to_string(),
            ),
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

#[cfg(test)]
pub mod test_utils {
    use super::*;

    pub fn make_dead_pool() -> deadpool_postgres::Pool {
        let mut cfg = Config::new();
        // Point to a port where nothing is listening
        cfg.host = Some("127.0.0.1".to_string());
        cfg.port = Some(1);
        cfg.dbname = Some("nonexistent".to_string());
        cfg.manager = Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        });

        // This succeeds because deadpool never connects on creation
        cfg.create_pool(Some(Runtime::Tokio1), NoTls).unwrap()
    }
}
