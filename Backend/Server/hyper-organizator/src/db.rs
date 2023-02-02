use crate::model::DBPersistence;
use deadpool_postgres::Client;
use tokio_postgres::{types::ToSql, Error, Row};

pub async fn get_by_id<ID, T>(client: &Client, id: &ID, username: &str) -> Result<T, Error>
where
    ID: ToSql + Sync,
    T: DBPersistence + From<Row>,
{
    let stmt = client.prepare(T::query()).await?;
    let row = client.query_one(&stmt, &[&id, &username]).await?;
    Ok(T::from(row))
}

pub async fn get_for_user<T>(client: &Client, username: &str) -> Result<Vec<T>, Error>
where
    T: DBPersistence + From<Row>,
{
    let stmt = client.prepare(T::query()).await?;
    let rows = client.query(&stmt, &[&username]).await?;
    Ok(rows.into_iter().map(|row| T::from(row)).collect())
}
