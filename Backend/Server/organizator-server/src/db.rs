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

/// The statement that puts the current user into the session for row level security.
///
/// A requester carrying the admin role reads everything the policies cover — that is what the
/// sentinel `0` means to them. Admin is a role the token carries, and it used to be decided by
/// asking whether the login was called "admin": any account with that name read every memo in
/// the system, whether or not it had been given the role, and an admin under any other name did
/// not.
fn current_user_statement(requester: &User) -> &'static str {
    if requester.is_admin() {
        include_str!("sql/admin/set_admin_user.sql")
    } else {
        include_str!("sql/set_current_user.sql")
    }
}

pub async fn get_json<'a>(
    client: &Client,
    requester: &'a User,
    SQLstr(query): SQLstr<'_>,
    params: &[&(dyn ToSql + Sync)],
) -> Result<(String, Requester<'a>), Error> {
    let username = requester.id();
    let is_admin = requester.is_admin();
    let begin_statement = client.prepare_cached("BEGIN").await?;
    let begin_future = client.execute(&begin_statement, &[]);

    let set_user = client.prepare_cached(current_user_statement(requester)).await?;
    let stmt = client.prepare_cached(query).await?;

    let set_user_params: &[&(dyn ToSql + Sync)] = if is_admin { &[] } else { &[&username] };
    let set_user_future = client.query_one(&set_user, set_user_params);
    let stmt_future = client.query_one(&stmt, params);

    let commit_statement = client.prepare_cached("COMMIT").await?;
    let commit_future = client.execute(&commit_statement, &[]);
    
    let (_b, u, row, _c) = try_join!(begin_future, set_user_future, stmt_future, commit_future)?;

    // The admin sentinel is the requester id as well, which is what the client is told: an admin
    // is nobody's idea of a memo's owner, so the memo reads as one they may look at.
    let user_id = if is_admin { 0 } else { u.get::<_, i32>(0) };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_is_a_role_and_not_a_name() {
        let merely_named_admin = User::new("admin", vec!["user"]);
        let admin_by_role = User::new("ovidiu", vec!["orgadm"]);

        // The account called "admin" reads as itself unless its token carries the role.
        assert!(current_user_statement(&merely_named_admin).contains("set_current_user($1)"));

        // Any name at all reads as the admin sentinel when the role is there.
        let admin_statement = current_user_statement(&admin_by_role);
        assert!(admin_statement.contains("'organizator.current_user', '0'"));
        // Set for the transaction rather than the session: a value that outlives the COMMIT would
        // still be there for whatever request draws the connection from the pool next.
        assert!(admin_statement.contains("'0', true"));
    }

    /// Whether a statement that fails inside the pipelined BEGIN / set_current_user / query /
    /// COMMIT leaves the connection it ran on usable.
    ///
    /// If the COMMIT is never sent, the connection goes back to the pool inside an aborted
    /// transaction, and every later request that draws it is answered with 25P02, "current
    /// transaction is aborted" — a server that stays broken until it is restarted. The question
    /// is whether `try_join!` can return before the COMMIT future has been polled; the same
    /// mechanism that pipelines the four statements (each is enqueued on its first poll) says it
    /// cannot, and this test is here to say which it is.
    ///
    /// It needs a database, so it is ignored by default. Run it with one up:
    ///
    ///   cargo test -p organizator-server -- --ignored --nocapture
    ///
    /// The connection string comes from TEST_DATABASE_URL, or is the test database the project
    /// documents.
    #[tokio::test]
    #[ignore = "needs a database; see the comment"]
    async fn a_failed_statement_leaves_the_connection_usable() {
        let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://postgres:postgres@localhost:5432/testdb".to_string()
        });
        let (client, connection) = tokio_postgres::connect(&url, tokio_postgres::NoTls)
            .await
            .expect("could not reach the test database");
        tokio::spawn(async move {
            let _ = connection.await;
        });

        let no_params: &[&(dyn ToSql + Sync)] = &[];

        // The shape db.rs builds, with the query failing: 1/0 raises 22012.
        let begin_statement = client.prepare("BEGIN").await.unwrap();
        let begin_future = client.execute(&begin_statement, no_params);
        let set_user = client
            .prepare("select set_config('organizator.current_user', '1', true)")
            .await
            .unwrap();
        let statement = client.prepare("select 1/0").await.unwrap();
        let set_user_future = client.query_one(&set_user, no_params);
        let statement_future = client.query_opt(&statement, no_params);
        let commit_statement = client.prepare("COMMIT").await.unwrap();
        let commit_future = client.execute(&commit_statement, no_params);

        let outcome =
            tokio::try_join!(begin_future, set_user_future, statement_future, commit_future);
        assert!(outcome.is_err(), "select 1/0 should have failed");

        // And the connection is used again, the way the pool would use it.
        let after = client.query_one("select 1", no_params).await;
        assert!(
            after.is_ok(),
            "the connection was left unusable: {:?}",
            after.err()
        );
    }
}
