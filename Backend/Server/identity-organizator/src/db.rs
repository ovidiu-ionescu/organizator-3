use deadpool_postgres::Client;
use lib_axum_organizator::typedef::{GenericError, SQLstr};
use serde::Serialize;
use tokio_postgres::{Row, types::ToSql};
use tracing::{debug, info};
use utoipa::ToSchema;

#[derive(Serialize, Debug)]
pub struct Login {
    pub id: i32,
    pub username: Option<String>,
    pub password_hash: Option<String>,
}

impl From<Row> for Login {
    fn from(row: Row) -> Self {
        Login {
            id: row.get("id"),
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
    client: &Client,
    requester: &str,
    username: &str,
    password_hash: &str,
) -> Result<(), GenericError> {
    debug!("Updating password for user 「{username}」, requester is 「{requester}」");
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let begin_future = client.execute(&begin_statement, &[]);
  
    let set_requester = client
        .prepare_cached(include_str!("sql/set_requester.sql"))
        .await?;

    let stmt = client
        .prepare_cached(include_str!("sql/update_password.sql"))
        .await?;

    let set_requester_params: &[&(dyn ToSql + Sync)] = &[&requester];
    let set_requester_future = client.query_one(&set_requester, set_requester_params);
    let stmt_params: &[&(dyn ToSql + Sync)] = &[&password_hash, &username];
    let stmt_future = client.execute(&stmt, stmt_params);

    let commit_statement = client.prepare_cached("COMMIT").await?;
    let commit_future = client.execute(&commit_statement, &[]);

    let (_b, u, rows, _c) = (begin_future.await, set_requester_future.await, stmt_future.await, commit_future.await);
    let user_id = u?.get::<_, i32>(0);
    let rows = rows?;

    Ok(())
}

pub async fn get_json_query(
    db_client: &Client,
    SQLstr(query): SQLstr<'_>,
    params: &[&(dyn ToSql + Sync)],
) -> Result<String, tokio_postgres::Error> {
    let stmt = db_client.prepare_cached(query).await?;
    let row = db_client.query_one(&stmt, params).await?;
    info!("Row is 「{:?}」", row);
    Ok(row.get(0))
}

/// A role as the API hands it out. The name is what the JWT carries; the description is what tells a
/// user which systems the role opens, and is empty rather than missing for a role that has none.
#[derive(Serialize, Debug, ToSchema)]
pub struct Role {
    pub id: i64,
    pub name: String,
    pub description: String,
}

impl From<Row> for Role {
    fn from(row: Row) -> Self {
        Role {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
        }
    }
}

pub async fn get_roles_for_user(
    db_client: &Client,
    username: &str,
) -> Result<Vec<Role>, tokio_postgres::Error> {
    let stmt = db_client
        .prepare_cached(include_str!("sql/get_roles_for_user.sql"))
        .await?;
    let rows = db_client.query(&stmt, &[&username]).await?;
    let roles: Vec<Role> = rows.into_iter().map(Role::from).collect();
    debug!("Roles for user {}: {:?}", username, roles);
    Ok(roles)
}
