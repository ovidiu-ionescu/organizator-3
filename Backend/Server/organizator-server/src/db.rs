//! Converts the database rows into the model structs.

use crate::model::{DBPersistence, Requester};
use deadpool_postgres::Client;
use lib_axum_organizator::typedef::SQLstr;
use tokio::try_join;
use tracing::{debug, trace};
use tokio_postgres::{Error, Row, types::ToSql};

pub enum QueryType {
    Select,
    // For search we want a list of hits, not full objects
    Search,
}

/// Fetch at most one row, or `None` when the query matches nothing.
///
/// A `query_one` would answer zero rows with a `RowNotFound` that carries no SQLSTATE code, so
/// `handle_pg_error_response` has nothing to match on and falls through to a 500 — a memo the
/// caller is not allowed to see then looks to the client like a broken server. RLS filters such
/// a row out rather than raising, so "not there, or not yours" arrives here as an ordinary
/// zero-row result, and each caller decides what that means for its own endpoint.
pub async fn get_single<'a, T>(
    client: &Client,
    username: &'a str,
    params: &[&(dyn ToSql + Sync)],
) -> Result<(Option<T>, Requester<'a>), Error>
where
    T: DBPersistence + From<Row>,
{
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let begin_future = client.execute(&begin_statement, &[]);
    // place the current user in the PostgreSQL session
    let set_user = client
        .prepare_cached(include_str!("sql/set_current_user.sql"))
        .await?;
    let stmt = client.prepare_cached(T::query()).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.query_opt(&stmt, params);

    let commit_statement = client.prepare_cached("COMMIT").await?;
    let commit_future = client.execute(&commit_statement, &[]);

    let (_b, u, row, _c) = try_join!(begin_future, set_user_future, stmt_future, commit_future)?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    if row.is_some() {
        trace!("Received one row from database");
    } else {
        trace!("Received no row from database");
    }
    Ok((row.map(T::from), requester))
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
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let begin_future = client.execute(&begin_statement, &[]);

    let set_user = client
        .prepare_cached(include_str!("sql/set_current_user.sql"))
        .await?;
    let stmt = client
        .prepare_cached(match query_type {
            QueryType::Select => T::query(),
            QueryType::Search => T::search(),
        })
        .await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.query(&stmt, params);

    let commit_statement = client.prepare_cached("COMMIT").await?;
    let commit_future = client.execute(&commit_statement, &[]);

    let (_b, u, rows, _c) = try_join!(begin_future, set_user_future, stmt_future, commit_future)?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    let rows = rows;
    trace!("Received {} rows from database", rows.len());
    Ok((
        rows.into_iter().map(|row| T::from(row)).collect(),
        requester,
    ))
}

pub async fn get_json<'a>(
    client: &Client,
    //query: SQLstr<'_>,
    username: &'a str,
    SQLstr(query): SQLstr<'_>,
    params: &[&(dyn ToSql + Sync)],
) -> Result<(String, Requester<'a>), Error> {
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let begin_future = client.execute(&begin_statement, &[]);

    let set_user = client
        .prepare_cached(if username == "admin" {
            include_str!("sql/admin/set_admin_user.sql")
        } else {
            include_str!("sql/set_current_user.sql")
        })
        .await?;
    let stmt = client.prepare_cached(query).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = if username == "admin" {
        &[]
    } else {
        &[&username]
    };
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.query_one(&stmt, params);

    let commit_statement = client.prepare_cached("COMMIT").await?;
    let commit_future = client.execute(&commit_statement, &[]);
    
    let (_b, u, row, _c) = try_join!(begin_future, set_user_future, stmt_future, commit_future)?;

    let user_id = if username == "admin" {
        0
    } else {
        u.get::<_, i32>(0)
    };
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
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let begin_future = client.execute(&begin_statement, &[]);

    let set_user = client
        .prepare_cached(include_str!("sql/set_current_user.sql"))
        .await?;
    let stmt = client.prepare(query).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.execute(&stmt, params);

    let commit_statement = client.prepare_cached("COMMIT").await?;
    let commit_future = client.execute(&commit_statement, &[]);
    
    let (_b, u, rows_affected, _c) = try_join!(begin_future, set_user_future, stmt_future, commit_future)?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    let rows_affected = rows_affected;
    trace!("Affected {} rows in the database", rows_affected);
    Ok((rows_affected, requester))
}
