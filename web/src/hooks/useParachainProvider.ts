import { createClient, type PolkadotClient, type TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { sandboxProvider, createPapiProvider, hostApi } from "@novasamatech/product-sdk";
import { enumValue } from "@novasamatech/host-api";
import { ppview } from "@polkadot-api/descriptors";
import { useEffect } from "react";
import { useChainStore } from "../store/chainStore";

const PPVIEW_GENESIS = "0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb";
const DEV_WS = "ws://127.0.0.1:9944";

type ParachainApi = TypedApi<typeof ppview>;

let _parachainClient: PolkadotClient | null = null;
let _parachainApi: ParachainApi | null = null;
let _initPromise: Promise<void> | null = null;

export function getParachainApi(): ParachainApi {
	if (!_parachainApi) throw new Error("Parachain provider not initialized");
	return _parachainApi;
}

async function initClient(): Promise<void> {
	if (_parachainClient) return;
	const inHost = sandboxProvider.isCorrectEnvironment();
	if (inHost) {
		await hostApi
			.permission(enumValue("v1", { tag: "TransactionSubmit", value: undefined }))
			.match(
				() => {},
				(err: unknown) => console.warn("Transaction permission denied:", err),
			);
		_parachainClient = createClient(createPapiProvider(PPVIEW_GENESIS));
	} else {
		_parachainClient = createClient(withPolkadotSdkCompat(getWsProvider(DEV_WS)));
	}
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
	const setConnected = useChainStore((s) => s.setConnected);

	// Init once.
	useEffect(() => {
		if (!_initPromise) {
			_initPromise = initClient()
				.then(() => {
					setConnected(true);
				})
				.catch((err) => {
					console.error("Parachain client init failed:", err);
				});
		}
	}, [setConnected]);

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
