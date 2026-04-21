import _sodium from 'libsodium-wrappers';

let _ready: Promise<typeof _sodium> | null = null;

/**
 * Memoized libsodium init. Every caller awaits this before touching
 * `_sodium.*` APIs; the promise resolves once for the lifetime of the
 * page.
 */
export function sodiumReady(): Promise<typeof _sodium> {
  if (!_ready) _ready = _sodium.ready.then(() => _sodium);
  return _ready;
}
