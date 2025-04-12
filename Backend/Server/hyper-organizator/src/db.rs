//! Converts the database rows into the model structs.

use crate::model::DBPersistence;
use deadpool_postgres::Client;
use log::trace;
use tokio_postgres::{types::ToSql, Error, Row};

pub enum QueryType {
  Select,
  Search,
}

pub async fn get_single<T>(client: &Client, params: &[&(dyn ToSql + Sync)]) -> Result<T, Error>
where
    T: DBPersistence + From<Row>,
{
    let stmt = client.prepare(T::query()).await?;
    let row = client.query_one(&stmt, params).await?;
    trace!("Received one row from database");
    Ok(T::from(row))
}

pub async fn get_multiple<T>(
    client: &Client,
    params: &[&(dyn ToSql + Sync)],
    query_type: QueryType,
) -> Result<Vec<T>, Error>
where
    T: DBPersistence + From<Row>,
{
    let stmt = client.prepare(
      match query_type {
        QueryType::Select => T::query(),
        QueryType::Search => T::search(),
      }).await?;
    let rows = client.query(&stmt, params).await?;
    trace!("Received {} rows from database", rows.len());
    Ok(rows.into_iter().map(|row| T::from(row)).collect())
}

pub async fn get_json(
    client: &Client,
    query: &str,
    params: &[&(dyn ToSql + Sync)],
) -> Result<String, Error> {
    let stmt = client.prepare(query).await?;
    let row = client.query_one(&stmt, params).await?;
    let json: String = row.get(0);
    Ok(json)
}

pub async fn execute(
  client: &Client,
  query: &str,
  params: &[&(dyn ToSql + Sync)],
) -> Result<u64, Error>
  {
  let stmt = client.prepare(query).await?;
  let rows_inserted = client.execute(&stmt, params).await?;
  Ok(rows_inserted)
}

