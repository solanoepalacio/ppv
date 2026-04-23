import { createClient, type PolkadotClient, type TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { sandboxProvider, hostApi } from "@novasamatech/product-sdk";
import { enumValue } from "@novasamatech/host-api";
import { ppview } from "@polkadot-api/descriptors";
import { useEffect } from "react";
import { useChainStore } from "../store/chainStore";

const DEV_WS = "ws://127.0.0.1:9944";

type ParachainApi = TypedApi<typeof ppview>;

let _parachainClient: PolkadotClient | null = null;
let _parachainApi: ParachainApi | null = null;
let _initPromise: Promise<void> | null = null;

export async function getParachainApi(): Promise<ParachainApi> {
	await ensureInit();
	if (!_parachainApi) throw new Error("Parachain provider init returned without api");
	return _parachainApi;
}

function ensureInit(): Promise<void> {
	if (!_initPromise) {
		_initPromise = initClient()
			.then(() => {
				useChainStore.getState().setConnected(true);
			})
			.catch((err) => {
				console.error("Parachain client init failed:", err);
				// Reset so a later caller can retry.
				_initPromise = null;
				throw err;
			});
	}
	return _initPromise;
}

async function initClient(): Promise<void> {
	if (_parachainClient) return;
	// The Triangle host's `createPapiProvider` only routes to chains the host
	// whitelists by genesis hash, which excludes our dev parachain. Since the
	// host sandbox allows direct outbound WebSockets (verified via /probe),
	// connect directly to the node in both host and standalone modes.
	if (sandboxProvider.isCorrectEnvironment()) {
		await hostApi
			.permission(enumValue("v1", { tag: "ExternalRequest", value: DEV_WS }))
			.match(
				() => {},
				(err: unknown) => console.warn("ExternalRequest permission denied:", err),
			);
	}
	_parachainClient = createClient(withPolkadotSdkCompat(getWsProvider(DEV_WS)));
	_parachainApi = _parachainClient.getTypedApi(ppview);
}

/**
 * Mount once in App. Initializes the PAPI client (transport depends on
 * host vs standalone) and subscribes to balance updates whenever the
 * selected account changes. The selected account is driven by the
 * WalletPicker via signerManager → chainStore.
 */
export function useParachainProvider() {
	const account = useChainStore((s) => s.account);
	const connected = useChainStore((s) => s.connected);
	const setBalance = useChainStore((s) => s.setBalance);

	// Init once. `ensureInit` is idempotent and also runs on demand from
	// `getParachainApi()`, so effects firing before this one are safe.
	useEffect(() => {
		void ensureInit().catch(() => {
			// Error already logged inside ensureInit.
		});
	}, []);

	// Resubscribe balance on account change OR once the client becomes ready.
	// `connected` flips true inside initClient().then(); gating on it ensures
	// we subscribe on the host path even when `account` was pre-populated by
	// signerManager's persistence before initClient resolved.
	useEffect(() => {
		if (!account || !connected || !_parachainApi) return;
		const sub = _parachainApi.query.System.Account.watchValue(account).subscribe({
			next: (info: { data: { free: bigint } }) => setBalance(info.data.free),
			error: (err: unknown) => console.error("Balance subscription error:", err),
		});
		return () => sub.unsubscribe();
	}, [account, connected, setBalance]);
}
