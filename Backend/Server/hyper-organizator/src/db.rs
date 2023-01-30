use crate::model::GetMemo;
use deadpool_postgres::Client;
use tokio_postgres::Error;

pub async fn get_memo(client: &Client, memo_id: i32, username: &str) -> Result<GetMemo, Error> {
    let stmt = client.prepare(include_str!("sql/get_memo.sql")).await?;
    let row = client.query_one(&stmt, &[&memo_id, &username]).await?;
    Ok(GetMemo::from(&row))
}
