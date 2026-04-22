// Workaround: PAPI's @polkadot-api/pjs-signer adapter builds the pjs
// signPayload request with `withSignedTransaction: true`. Talisman honours
// that flag and returns a fully-rebuilt extrinsic, which PAPI then submits
// verbatim — bypassing the createV4Tx path that would encode the signer as
// `MultiAddress::Id(AccountId32)`. On ppview (custom dev chain, unknown to
// Talisman), the rebuilt extrinsic uses a MultiAddress variant the runtime's
// default StaticLookup can't resolve → CannotLookup. polkadot-js doesn't
// implement withSignedTransaction, so it falls through correctly.
//
// We patch window.injectedWeb3[name] so every signPayload call forces
// withSignedTransaction=false and strips any signedTransaction field from
// the response — forcing PAPI down the createV4Tx path uniformly.

interface PjsPayloadIn {
  withSignedTransaction?: boolean;
  [k: string]: unknown;
}

interface PjsSigner {
  signPayload: (pjs: PjsPayloadIn) => Promise<Record<string, unknown>>;
  signRaw: (...args: unknown[]) => Promise<unknown>;
}

interface InjectedEntry {
  enable: (dappName?: string) => Promise<{ signer: PjsSigner; accounts: unknown }>;
  version?: string;
}

const PATCH_MARK = Symbol.for('ppview.pjsPatch.enabled');

export function patchInjectedWeb3ForPapi(name: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const injected = (window as any).injectedWeb3 as Record<string, InjectedEntry> | undefined;
  const entry = injected?.[name];
  if (!entry) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((entry as any)[PATCH_MARK]) return;

  const originalEnable = entry.enable.bind(entry);

  entry.enable = async (dappName?: string) => {
    const ext = await originalEnable(dappName);
    const origSignPayload = ext.signer.signPayload.bind(ext.signer);
    ext.signer.signPayload = async (pjs: PjsPayloadIn) => {
      const forced = { ...pjs, withSignedTransaction: false };
      const result = await origSignPayload(forced);
      // Defensive: some extensions ignore the flag and still return
      // signedTransaction. Strip it so PAPI falls through to createV4Tx.
      if (result && 'signedTransaction' in result) {
        const { signedTransaction: _drop, ...rest } = result as Record<string, unknown>;
        void _drop;
        return rest;
      }
      return result;
    };
    return ext;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (entry as any)[PATCH_MARK] = true;
}
