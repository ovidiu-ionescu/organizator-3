//! Converts the database rows into the model structs.

use crate::model::{DBPersistence, Requester};
use lib_axum_organizator::security::jot::User;
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
    let stmt = client.prepare_cached(T::query()).await?;

    let (row, requester) = in_transaction(client, username, || {
        client.query_opt(&stmt, params)
    })
    .await?;

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
    let stmt = client
        .prepare_cached(match query_type {
            QueryType::Select => T::query(),
            QueryType::Search => T::search(),
        })
        .await?;

    let (rows, requester) =
        in_transaction(client, username, || client.query(&stmt, params)).await?;

    trace!("Received {} rows from database", rows.len());
    Ok((rows.into_iter().map(T::from).collect(), requester))
}

pub async fn get_json<'a>(
    client: &Client,
    requester: &'a User,
    SQLstr(query): SQLstr<'_>,
    params: &[&(dyn ToSql + Sync)],
) -> Result<(String, Requester<'a>), Error> {
    let username = requester.id();
    let stmt = client.prepare_cached(query).await?;

    let (row, requester) =
        in_transaction(client, username, || client.query_one(&stmt, params)).await?;

    trace!("Received one row from database");
    Ok((row.get(0), requester))
}

pub async fn execute<'a>(
    client: &Client,
    username: &'a str,
    query: &str,
    params: &[&(dyn ToSql + Sync)],
) -> Result<(u64, Requester<'a>), Error> {
    let stmt = client.prepare(query).await?;

    let (n, requester) =
        in_transaction(client, username, || client.execute(&stmt, params)).await?;

    trace!("Affected {} rows in the database", n);
    Ok((n, requester))
}

async fn in_transaction<'a, F, Fut, R>(
    client: &Client,
    username: &'a str,
    make_stmt_future: F,
) -> Result<(R, Requester<'a>), Error>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<R, Error>>,
{
    let rollback_statement = client.prepare_cached("ROLLBACK").await?;
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let set_user = client
        .prepare_cached(include_str!("sql/set_current_user.sql"))
        .await?;
    let commit_statement = client.prepare_cached("COMMIT").await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = &[&username];

    // Creation order is what fixes the server-side execution order:
    // rollback → begin → set_current_user → <caller's stmt> → commit
    let rollback_future = client.execute(&rollback_statement, &[]);
    let begin_future = client.execute(&begin_statement, &[]);
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = make_stmt_future();
    let commit_future = client.execute(&commit_statement, &[]);

    let (_r, _b, u, result, _c) = try_join!(
        rollback_future,
        begin_future,
        set_user_future,
        stmt_future,
        commit_future
    )?;

    let user_id = u.get::<_, i32>(0);
    let requester = Requester::new(user_id, username);
    debug!("Requester is {:?}", requester);
    Ok((result, requester))
}
