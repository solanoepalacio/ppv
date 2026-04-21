import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEncryptionKey } from './useEncryptionKey';
import { createSessionStorage } from './useSessionStorage';

const ADDR = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('useEncryptionKey', () => {
  it('generates a keypair on first run and persists the private half', async () => {
    window.localStorage.clear();
    const storage = createSessionStorage({ inSandbox: false });

    const { result } = renderHook(() => useEncryptionKey(ADDR, { storage }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toHaveLength(32);
    expect(result.current.privateKey).toHaveLength(32);

    const stored = await storage.readBytes(`ppview:x25519:${ADDR}`);
    expect(stored).not.toBeNull();
    expect(Array.from(stored!)).toEqual(Array.from(result.current.privateKey!));
  });

  it('loads an existing private key instead of regenerating', async () => {
    window.localStorage.clear();
    const storage = createSessionStorage({ inSandbox: false });
    const existing = new Uint8Array(32).fill(0x11);
    await storage.writeBytes(`ppview:x25519:${ADDR}`, existing);

    const { result } = renderHook(() => useEncryptionKey(ADDR, { storage }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(Array.from(result.current.privateKey!)).toEqual(Array.from(existing));
  });

  it('returns ready=false while address is null', async () => {
    const { result } = renderHook(() => useEncryptionKey(null));
    expect(result.current.ready).toBe(false);
    expect(result.current.publicKey).toBeNull();
  });
});
