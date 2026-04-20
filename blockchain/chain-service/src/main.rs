mod cli;

use anyhow::Result;
use clap::Parser;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    let args = cli::Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(&args.log))
        .with_target(false)
        .init();

    info!(rpc_url = %args.rpc_url, "ppview-chain-service starting");
    info!("scaffold only — event loop lands in Task 9");

    Ok(())
}
