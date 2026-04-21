use anyhow::Result;
use clap::Parser;
use ppview_chain_service::{chain, cli, signer_key};
use subxt_signer::sr25519::Keypair;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    let args = cli::Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(&args.log))
        .with_target(false)
        .init();

    let signer = load_signer(&args)?;

    if let Some(cli::Command::PrintServiceAccount) = args.command {
        print_service_account(&signer);
        return Ok(());
    }

    info!(rpc_url = %args.rpc_url, "ppview-chain-service starting");
    info!(
        service_signer_pubkey = %hex::encode(signer.public_key().0),
        "service signer loaded"
    );
    info!("scaffold only — event loop lands in Task 9");

    Ok(())
}

fn load_signer(args: &cli::Args) -> Result<Keypair> {
    match &args.service_suri {
        Some(suri) => chain::signer_from_suri(suri),
        None => signer_key::load_signer(&args.service_signer_path),
    }
}

fn print_service_account(signer: &Keypair) {
    let raw = signer.public_key().0;
    println!("AccountId (raw 32-byte hex): 0x{}", hex::encode(raw));
    println!();
    println!("Paste into blockchain/runtime/src/genesis_config_presets.rs as:");
    println!();
    println!("const SERVICE_ACCOUNT_ID: [u8; 32] = [");
    for chunk in raw.chunks(16) {
        let row: Vec<String> = chunk.iter().map(|b| format!("0x{b:02x}")).collect();
        println!("\t{},", row.join(", "));
    }
    println!("];");
}
