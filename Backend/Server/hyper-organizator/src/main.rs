mod authentication;
mod logging;
mod metrics;
mod response_utils;
mod router;
mod server;
mod settings;
mod typedef;
mod under_construction;

use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Setup tracing
    tracing_subscriber::fmt::init();
    //console_subscriber::init();

    server::start_servers(router::router).await?;
    Ok(())
}
