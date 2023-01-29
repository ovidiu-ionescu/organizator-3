use crate::model::GetMemo;
use deadpool_postgres::Client;
use lib_hyper_organizator::typedef::GenericError;

pub async fn get_memo(
    client: &Client,
    memo_id: i32,
    username: &str,
) -> Result<GetMemo, GenericError> {
    let stmt = client.prepare(include_str!("sql/get_memo.sql")).await?;
    let row = client.query_one(&stmt, &[&memo_id, &username]).await?;
    Ok(GetMemo::from(&row))
}
