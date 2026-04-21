use anyhow::{Context, Result};
use clap::Parser;
use futures::StreamExt;
use ppview_chain_service::chain::{stream_events, Chain};
use ppview_chain_service::handler::wrap_and_grant;
use ppview_chain_service::reconcile::backfill;
use ppview_chain_service::{chain, cli, keys, signer_key};
use subxt_signer::sr25519::Keypair;
use tracing::{error, info};

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

    let svc_priv = keys::load_svc_priv(&args.svc_priv_path).with_context(|| {
        format!("loading SVC_PRIV from {}", args.svc_priv_path.display())
    })?;

    let chain = Chain::connect(&args.rpc_url)
        .await
        .with_context(|| format!("connecting to {}", args.rpc_url))?;

    backfill(&chain, &signer, &svc_priv)
        .await
        .context("startup reconciliation failed")?;

    let mut stream = Box::pin(stream_events(chain.clone()));
    info!("live stream active — waiting for PurchaseCompleted / ListingCreated events");

    let shutdown = tokio::signal::ctrl_c();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            biased;
            _ = &mut shutdown => {
                info!("SIGINT received — shutting down");
                return Ok(());
            }
            item = stream.next() => match item {
                Some(Ok(trigger)) => {
                    if let Err(e) = wrap_and_grant(
                        &chain,
                        &signer,
                        &svc_priv,
                        trigger.listing_id,
                        &trigger.target,
                        trigger.kind,
                    ).await {
                        error!(
                            listing_id = trigger.listing_id,
                            target = %trigger.target,
                            kind = ?trigger.kind,
                            error = ?e,
                            "wrap_and_grant failed — event skipped; reconciliation at next startup will retry"
                        );
                    }
                }
                Some(Err(e)) => {
                    error!(error = ?e, "event stream error — exiting; supervisor should restart and reconciliation will catch up");
                    return Err(e);
                }
                None => {
                    error!("event stream ended unexpectedly — exiting");
                    return Ok(());
                }
            }
        }
    }
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
