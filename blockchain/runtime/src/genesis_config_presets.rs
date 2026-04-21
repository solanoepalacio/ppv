use crate::{
	AccountId, BalancesConfig, CollatorSelectionConfig, ContentRegistryConfig, ParachainInfoConfig,
	PolkadotXcmConfig, RuntimeGenesisConfig, SessionConfig, SessionKeys, SudoConfig,
	EXISTENTIAL_DEPOSIT,
};

use alloc::{vec, vec::Vec};

use polkadot_sdk::{staging_xcm as xcm, *};

use cumulus_primitives_core::ParaId;
use frame_support::build_struct_json_patch;
use parachains_common::AuraId;
use serde_json::Value;
use sp_genesis_builder::PresetId;
use sp_keyring::Sr25519Keyring;
use xcm::prelude::XCM_VERSION;

/// The default XCM version to set in genesis config.
const SAFE_XCM_VERSION: u32 = XCM_VERSION;
/// Parachain id used for genesis config presets.
pub const PARACHAIN_ID: u32 = 1000;

/// SVC_PUB x25519 bytes baked into the chain-spec at genesis. The matching
/// SVC_PRIV is held by the content-unlock-service daemon (see `scripts/gen-service-key.sh`,
/// which writes the keypair into `<repo>/keys/`).
const SERVICE_PUBLIC_KEY: [u8; 32] = [
	0x51, 0x56, 0xb2, 0xb7, 0x0d, 0x28, 0x0e, 0xbb, 0x7f, 0x71, 0x0c, 0x1f, 0xca, 0x32, 0xfb, 0x54,
	0x70, 0x96, 0xd4, 0xaf, 0x4e, 0x31, 0xe5, 0xb3, 0x70, 0x4b, 0xc7, 0x62, 0xd3, 0x9c, 0x3a, 0x1c,
];

/// sr25519 AccountId of the content-unlock-service signer. Must resolve from the SURI
/// in `<repo>/keys/svc_signer.suri`; the daemon signs `grant_access` with
/// that key. Regenerate via `scripts/gen-service-key.sh` + derive with
/// `cargo run -p ppview-content-unlock-service -- print-service-account`.
const SERVICE_ACCOUNT_ID: [u8; 32] = [
	0xc0, 0x48, 0x83, 0xe2, 0xdf, 0x86, 0x32, 0x0a, 0x16, 0xe3, 0xdc, 0x4e, 0x4e, 0x4d, 0xac, 0x37,
	0x83, 0x3d, 0xf6, 0xb6, 0x35, 0xba, 0x25, 0x68, 0xe4, 0x46, 0x12, 0x89, 0xe7, 0xc3, 0xf8, 0x50,
];

/// Generate the session keys from individual elements.
pub fn session_keys(keys: AuraId) -> SessionKeys {
	SessionKeys { aura: keys }
}

fn testnet_genesis(
	invulnerables: Vec<(AccountId, AuraId)>,
	endowed_accounts: Vec<AccountId>,
	root: AccountId,
	id: ParaId,
) -> Value {
	build_struct_json_patch!(RuntimeGenesisConfig {
		balances: BalancesConfig {
			balances: endowed_accounts
				.iter()
				.cloned()
				.map(|k| (k, 1u128 << 60))
				.collect::<Vec<_>>(),
		},
		parachain_info: ParachainInfoConfig { parachain_id: id },
		collator_selection: CollatorSelectionConfig {
			invulnerables: invulnerables.iter().cloned().map(|(acc, _)| acc).collect::<Vec<_>>(),
			candidacy_bond: EXISTENTIAL_DEPOSIT * 16,
		},
		session: SessionConfig {
			keys: invulnerables
				.into_iter()
				.map(|(acc, aura)| { (acc.clone(), acc, session_keys(aura),) })
				.collect::<Vec<_>>(),
		},
		polkadot_xcm: PolkadotXcmConfig { safe_xcm_version: Some(SAFE_XCM_VERSION) },
		sudo: SudoConfig { key: Some(root) },
		content_registry: ContentRegistryConfig {
			service_public_key: SERVICE_PUBLIC_KEY,
			service_account_id: Some(AccountId::from(SERVICE_ACCOUNT_ID)),
		},
	})
}

fn local_testnet_genesis() -> Value {
	testnet_genesis(
		vec![
			(Sr25519Keyring::Alice.to_account_id(), Sr25519Keyring::Alice.public().into()),
			(Sr25519Keyring::Bob.to_account_id(), Sr25519Keyring::Bob.public().into()),
		],
		Sr25519Keyring::well_known().map(|k| k.to_account_id()).collect(),
		Sr25519Keyring::Alice.to_account_id(),
		PARACHAIN_ID.into(),
	)
}

/// Ethereum dev accounts (Alith, Baltathar, Charleth) with 0xEE padding to 32 bytes.
/// These are the standard dev accounts recognized by the eth-rpc adapter.
fn eth_dev_accounts() -> Vec<AccountId> {
	use sp_core::crypto::AccountId32;
	[
		// Alith
		hex_literal::hex!("f24ff3a9cf04c71dbc94d0b566f7a27b94566caceeeeeeeeeeeeeeeeeeeeeeee"),
		// Baltathar
		hex_literal::hex!("3cd0a705a2dc65e5b1e1205896baa2be8a07c6e0eeeeeeeeeeeeeeeeeeeeeeee"),
		// Charleth
		hex_literal::hex!("798d4ba9baf0064ec19eb4f0a1a45785ae9d6dfceeeeeeeeeeeeeeeeeeeeeeee"),
	]
	.into_iter()
	.map(AccountId32::from)
	.collect()
}

fn development_config_genesis() -> Value {
	let mut endowed: Vec<AccountId> =
		Sr25519Keyring::well_known().map(|k| k.to_account_id()).collect();
	endowed.extend(eth_dev_accounts());

	testnet_genesis(
		vec![
			(Sr25519Keyring::Alice.to_account_id(), Sr25519Keyring::Alice.public().into()),
			(Sr25519Keyring::Bob.to_account_id(), Sr25519Keyring::Bob.public().into()),
		],
		endowed,
		Sr25519Keyring::Alice.to_account_id(),
		PARACHAIN_ID.into(),
	)
}

/// Provides the JSON representation of predefined genesis config for given `id`.
pub fn get_preset(id: &PresetId) -> Option<vec::Vec<u8>> {
	let patch = match id.as_ref() {
		sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET => local_testnet_genesis(),
		sp_genesis_builder::DEV_RUNTIME_PRESET => development_config_genesis(),
		_ => return None,
	};
	Some(
		serde_json::to_string(&patch)
			.expect("serialization to json is expected to work. qed.")
			.into_bytes(),
	)
}

/// List of supported presets.
pub fn preset_names() -> Vec<PresetId> {
	vec![
		PresetId::from(sp_genesis_builder::DEV_RUNTIME_PRESET),
		PresetId::from(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET),
	]
}
