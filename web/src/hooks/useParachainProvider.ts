import { createClient, AccountId, type PolkadotClient, type PolkadotSigner, type TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  sandboxProvider,
  sandboxTransport,
  createPapiProvider,
  createAccountsProvider,
  hostApi,
} from '@novasamatech/product-sdk';
import { enumValue } from '@novasamatech/host-api';
import { ppview } from '@polkadot-api/descriptors';
import { useEffect } from 'react';
import { useChainStore } from '../store/chainStore';
import { devAccounts } from './useAccount';

const PPVIEW_GENESIS = '0x4545454545454545454545454545454545454545454545454545454545454545';
const DEV_WS = 'ws://127.0.0.1:9944';
const SS58_PREFIX = 42;

const addressCodec = AccountId(SS58_PREFIX);

type ParachainApi = TypedApi<typeof ppview>;

let _parachainClient: PolkadotClient | null = null;
let _parachainApi: ParachainApi | null = null;
let _currentSigner: PolkadotSigner | null = null;

export function getParachainApi(): ParachainApi {
  if (!_parachainApi) throw new Error('Parachain provider not initialized');
  return _parachainApi;
}

export function getCurrentSigner(): PolkadotSigner {
  if (!_currentSigner) throw new Error('No signer — provider not initialized');
  return _currentSigner;
}

async function initProvider(): Promise<{ address: string | null }> {
  const inHost = sandboxProvider.isCorrectEnvironment();

  if (inHost) {
    await hostApi
      .permission(enumValue('v1', { tag: 'TransactionSubmit', value: undefined }))
      .match(
        () => {},
        (err: unknown) => console.warn('Transaction permission denied:', err),
      );

    const papiProvider = createPapiProvider(PPVIEW_GENESIS);
    _parachainClient = createClient(papiProvider);
    _parachainApi = _parachainClient.getTypedApi(ppview);

    const accountsProvider = createAccountsProvider(sandboxTransport);
    const res = await accountsProvider.getNonProductAccounts();
    const acct = res.match(
      (accts: { publicKey: Uint8Array; name?: string }[]) => accts[0] ?? null,
      () => null,
    );

    if (acct) {
      const address = addressCodec.dec(acct.publicKey);
      _currentSigner = accountsProvider.getNonProductAccountSigner(acct as any);
      return { address };
    }
    return { address: null };
  } else {
    _parachainClient = createClient(withPolkadotSdkCompat(getWsProvider(DEV_WS)));
    _parachainApi = _parachainClient.getTypedApi(ppview);
    _currentSigner = devAccounts[0].signer;
    return { address: devAccounts[0].address };
  }
}

/**
 * Mount once in App. Initializes the PAPI client, gets the account,
 * and subscribes to balance updates.
 */
export function useParachainProvider() {
  const setAccount = useChainStore((s) => s.setAccount);
  const setBalance = useChainStore((s) => s.setBalance);
  const setConnected = useChainStore((s) => s.setConnected);

  useEffect(() => {
    let balanceSub: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    initProvider()
      .then(({ address }) => {
        if (cancelled) return;
        setAccount(address);
        setConnected(true);

        if (address && _parachainApi) {
          balanceSub = _parachainApi.query.System.Account.watchValue(address).subscribe({
            next: (info: { data: { free: bigint } }) => setBalance(info.data.free),
            error: (err: unknown) => console.error('Balance subscription error:', err),
          });
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      balanceSub?.unsubscribe();
    };
  }, [setAccount, setBalance, setConnected]);
}
