mod authentication;
mod metrics;
mod response_utils;
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

    server::start_servers().await?;
    Ok(())
}
