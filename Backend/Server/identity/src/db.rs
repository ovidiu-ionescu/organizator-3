use deadpool_postgres::Client;
use lib_hyper_organizator::typedef::GenericError;
use serde::Serialize;
use tokio_postgres::Row;

#[derive(Serialize, Debug)]
pub struct Login {
    pub id:       i32,
    pub username: Option<String>,
    pub salt:     Vec<u8>,
    pub pbkdf2:   Vec<u8>,
}

impl From<Row> for Login {
    fn from(row: Row) -> Self {
        Login {
            id:       row.get("id"),
            username: row.get("username"),
            pbkdf2:   row.get("pbkdf2"),
            salt:     row.get("salt"),
        }
    }
}

pub async fn fetch_login(client: Client, username: &str) -> Result<Login, GenericError> {
    let stmt = client.prepare(include_str!("sql/login.sql")).await?;
    let row = client.query_one(&stmt, &[&username]).await?;
    Ok(Login::from(row))
}
