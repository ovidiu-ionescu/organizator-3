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
    let subscriber = tracing_subscriber::FmtSubscriber::new();
    tracing::subscriber::set_global_default(subscriber)?;

    server::start_servers().await?;
    Ok(())
}
