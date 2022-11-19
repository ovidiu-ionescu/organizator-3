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
    server::start_servers().await?;
    Ok(())
}
