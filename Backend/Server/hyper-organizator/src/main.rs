mod db;
mod model;
mod router;

use lib_hyper_organizator::server;

use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Setup tracing
    tracing_subscriber::fmt::init();
    //console_subscriber::init();

    server::start_servers(router::router, None).await?;
    Ok(())
}
