use deadpool_postgres::Client;
use lib_hyper_organizator::typedef::GenericError;
use serde::Serialize;
use tokio_postgres::Row;
use tracing::debug;

#[derive(Serialize, Debug)]
pub struct Login {
    pub id:       i32,
    pub username: Option<String>,
    pub password_hash: Option<String>,
}

impl From<Row> for Login {
    fn from(row: Row) -> Self {
        Login {
            id:       row.get("id"),
            username: row.get("username"),
            password_hash: row.get("password_hash"),
        }
    }
}

pub async fn fetch_login(client: &Client, username: &str) -> Result<Login, GenericError> {
    let stmt = client.prepare_cached(include_str!("sql/login.sql")).await?;
    let row = client.query_one(&stmt, &[&username]).await?;
    Ok(Login::from(row))
}

pub async fn update_password(
    db_client: &Client,
    requester: &str,
    username: &str,
    password_hash: &str,
) -> Result<(), GenericError> {
    debug!("Setting requester to {}", requester);
    let set_requester = db_client.prepare_cached(include_str!("sql/set_requester.sql")).await?;
    db_client.execute(&set_requester, &[&requester]).await?;
    debug!("Updating password for {}", username);
    let stmt = db_client
        .prepare_cached(include_str!("sql/update_password.sql"))
        .await?;
    let rows = db_client
        .execute(&stmt, &[&password_hash, &username])
        .await?;
    if rows == 0 {
      let err = format!("No rows updated when updating password for user 「{}」", username);
        return Err(GenericError::from(err));
    }
    Ok(())
}
