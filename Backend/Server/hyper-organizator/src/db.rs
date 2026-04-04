//! Converts the database rows into the model structs.

use crate::model::{DBPersistence, Requester};
use deadpool_postgres::Client;
use log::{trace, debug};
use tokio_postgres::{types::ToSql, Error, Row};
use std::ops::Deref;
use lib_hyper_organizator::typedef::SQLstr;

pub enum QueryType {
  Select,
  // For search we want a list of hits, not full objects
  Search,
}



pub async fn get_single<'a, T>(client: &Client, username: &'a str, params: &[&(dyn ToSql + Sync)]) -> Result<(T, Requester<'a>), Error>
where
    T: DBPersistence + From<Row>,
{
    // place the current user in the PostgreSQL session
    let set_user = client.prepare_cached(include_str!("sql/set_current_user.sql")).await?;
    let stmt = client.prepare_cached(T::query()).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future= client.query_one(&stmt, params);
    let (u, row) = tokio::try_join!(set_user_future, stmt_future)?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    trace!("Received one row from database");
    Ok((T::from(row), requester))
}

pub async fn get_multiple<'a, T>(
    client: &Client,
    username: &'a str,
    params: &[&(dyn ToSql + Sync)],
    query_type: QueryType,
) -> Result<(Vec<T>, Requester<'a>), Error>
where
    T: DBPersistence + From<Row>,
{
    let set_user = client.prepare_cached(include_str!("sql/set_current_user.sql")).await?;
    let stmt = client.prepare_cached(
      match query_type {
        QueryType::Select => T::query(),
        QueryType::Search => T::search(),
      }).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.query(&stmt, params);
    let (u, rows) = tokio::try_join!(set_user_future, stmt_future)?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    trace!("Received {} rows from database", rows.len());
    Ok((rows.into_iter().map(|row| T::from(row)).collect(), requester))
}

pub async fn get_json<'a>(
    client: &Client,
    //query: SQLstr<'_>,
    username: &'a str,
    SQLstr(query): SQLstr<'_>,
    params: &[&(dyn ToSql + Sync)],
) -> Result<(String, Requester<'a>), Error> {
    let set_user = client.prepare_cached(
      if username == "admin" {
        include_str!("sql/admin/set_admin_user.sql")
      } else {
        include_str!("sql/set_current_user.sql")
      }
      ).await?;
    let stmt = client.prepare(query).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = if username == "admin" {
      &[]
    } else  {
      &[&username]
    };
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future= client.query_one(&stmt, params);
    let (u, row) = tokio::try_join!(set_user_future, stmt_future)?;

    let user_id = if username == "admin" { 0 }  else { u.get::<_, i32>(0) };
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    trace!("Received one row from database");

    let json: String = row.get(0);
    Ok((json, requester))
}

pub async fn execute<'a>(
  client: &Client,
  username: &'a str,
  query: &str,
  params: &[&(dyn ToSql + Sync)],
) -> Result<(u64, Requester<'a>), Error> {
  let set_user = client.prepare_cached(include_str!("sql/set_current_user.sql")).await?;
  let stmt = client.prepare(query).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.execute(&stmt, params);
    let (u, rows_affected) = tokio::try_join!(set_user_future, stmt_future)?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    trace!("Affected {} rows in the database", rows_affected);
  Ok((rows_affected, requester))
}

