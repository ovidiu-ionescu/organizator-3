use crate::settings::Postgres;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use tokio_postgres::NoTls;
use tower::ServiceBuilder;
use tower_http::add_extension::AddExtensionLayer;
use tower_layer::Stack;
use tracing::info;

#[cfg(not(feature = "postgres"))]
pub fn add_database<L>(service_builder: ServiceBuilder<L>, _: Postgres) -> ServiceBuilder<L> {
    info!("No database support");
    service_builder
}

#[cfg(feature = "postgres")]
pub fn add_database<L>(
    service_builder: ServiceBuilder<L>,
    postgres: Postgres,
) -> ServiceBuilder<Stack<AddExtensionLayer<Pool>, L>> {
    info!("Database support enabled");
    service_builder.layer(AddExtensionLayer::new(make_database_pool(postgres)))
}

#[cfg(feature = "postgres")]
fn make_database_pool(postgres: Postgres) -> Pool {
    let config = Config {
        host: Some(postgres.host),
        port: Some(postgres.port),
        user: Some(postgres.user),
        password: Some(postgres.password),
        dbname: Some(postgres.dbname),
        application_name: Some("tower-grpc-example".to_string()),
        manager: Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
            ..Default::default()
        }),
        ..Default::default()
    };
    config.create_pool(Some(Runtime::Tokio1), NoTls).unwrap()
}
