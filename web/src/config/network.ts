const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const LOCAL_WS_URL = import.meta.env.VITE_LOCAL_WS_URL || "ws://localhost:9944";

export const TESTNET_WS_URL = "wss://services.polkadothub-rpc.com/testnet";

export type NetworkPreset = "local" | "testnet";

function isLocalHost() {
	if (typeof window === "undefined") {
		return true;
	}

	return LOCAL_HOSTS.has(window.location.hostname);
}

export function getDefaultWsUrl() {
	return import.meta.env.VITE_WS_URL || (isLocalHost() ? LOCAL_WS_URL : TESTNET_WS_URL);
}

export function getNetworkPresetEndpoints(preset: NetworkPreset) {
	return preset === "local"
		? {
				wsUrl: LOCAL_WS_URL,
			}
		: {
				wsUrl: TESTNET_WS_URL,
			};
}

function getStoredUrl(storageKey: string, defaultKey: string, defaultValue: string) {
	const storedValue = localStorage.getItem(storageKey);
	const previousDefault = localStorage.getItem(defaultKey);
	localStorage.setItem(defaultKey, defaultValue);

	if (!storedValue || storedValue === previousDefault) {
		return defaultValue;
	}

	return storedValue;
}

export function getStoredWsUrl() {
	return getStoredUrl("ws-url", "default-ws-url", getDefaultWsUrl());
}
