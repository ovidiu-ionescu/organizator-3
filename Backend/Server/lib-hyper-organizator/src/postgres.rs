use crate::settings::PostgresConfig;
use tower::ServiceBuilder;
use tracing::info;

pub use submodule::add_database;
#[cfg(feature = "postgres")]
pub use submodule::get_connection;

#[cfg(not(feature = "postgres"))]
mod submodule {
    use super::*;
    pub async fn add_database<L>(
        service_builder: ServiceBuilder<L>,
        _: PostgresConfig,
    ) -> ServiceBuilder<L> {
        info!("No database support");
        service_builder
    }
}

#[cfg(feature = "postgres")]
mod submodule {
    use super::*;
    use crate::typedef::GenericError;
    use deadpool_postgres::Client;
    use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
    use http::Request;
    use tokio_postgres::NoTls;
    use tower_http::add_extension::AddExtensionLayer;
    use tower_layer::Stack;

    pub async fn add_database<L>(
        service_builder: ServiceBuilder<L>,
        postgres: PostgresConfig,
    ) -> ServiceBuilder<Stack<AddExtensionLayer<Pool>, L>> {
        info!("Database support enabled");
        service_builder.layer(AddExtensionLayer::new(make_database_pool(postgres).await))
    }

    async fn make_database_pool(postgres: PostgresConfig) -> Pool {
        let config = Config {
            host: Some(postgres.host),
            port: Some(postgres.port),
            user: Some(postgres.user),
            password: Some(postgres.password),
            dbname: Some(postgres.dbname),
            application_name: Some(postgres.application_name),
            manager: Some(ManagerConfig {
                recycling_method: RecyclingMethod::Fast,
            }),
            ..Default::default()
        };
        let pool = config.create_pool(Some(Runtime::Tokio1), NoTls).unwrap();
        // check we can connect to the Database, we abort if we can't
        match pool.get().await {
            Ok(_) => info!("Connected to database"),
            Err(e) => panic!("Failed to connect to database: {e},\nusing config: {config:#?}"),
        }

        pool
    }

    pub async fn get_connection<T>(request: &Request<T>) -> Result<Client, GenericError> {
        let pool = request
            .extensions()
            .get::<Pool>()
            .ok_or(GenericError::from("No database connection pool"))?;
        // let a_boxed_error = Box::<dyn Error + Send + Sync>::from(a_str_error);
        let connection = pool.get().await?;
        info!("Got connection from pool");
        Ok(connection)
    }
}
