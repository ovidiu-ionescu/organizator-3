use deadpool_postgres::PoolError;
use tokio_postgres::error::Error as PostgresError;

#[derive(Display, Debug, From)]
pub enum DatabaseError {
    NotFound,
    PGError(PostgresError),
    PoolError(PoolError),
    Utf8Error(std::str::Utf8Error),
}

impl std::error::Error for DatabaseError {}
