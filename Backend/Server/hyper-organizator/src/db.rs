//! Converts the database rows into the model structs.

use crate::model::DBPersistence;
use deadpool_postgres::Client;
use tokio_postgres::{types::ToSql, Error, Row};

pub async fn get_single<T>(client: &Client, params: &[&(dyn ToSql + Sync)]) -> Result<T, Error>
where
    T: DBPersistence + From<Row>,
{
    let stmt = client.prepare(T::query()).await?;
    let row = client.query_one(&stmt, params).await?;
    Ok(T::from(row))
}

pub async fn get_multiple<T>(
    client: &Client,
    params: &[&(dyn ToSql + Sync)],
) -> Result<Vec<T>, Error>
where
    T: DBPersistence + From<Row>,
{
    let stmt = client.prepare(T::query()).await?;
    let rows = client.query(&stmt, params).await?;
    Ok(rows.into_iter().map(|row| T::from(row)).collect())
}
