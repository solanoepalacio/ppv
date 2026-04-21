import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStorage } from './useSessionStorage';

describe('createSessionStorage (dev mode)', () => {
  beforeEach(() => {
    // jsdom-flavored localStorage is shared per test file; clear before each.
    globalThis.localStorage?.clear();
  });

  it('writes and reads bytes via window.localStorage when not in sandbox', async () => {
    const storage = createSessionStorage({ inSandbox: false });
    await storage.writeBytes('k', new Uint8Array([1, 2, 3]));
    const got = await storage.readBytes('k');
    expect(Array.from(got!)).toEqual([1, 2, 3]);
  });

  it('returns null when key is missing', async () => {
    const storage = createSessionStorage({ inSandbox: false });
    expect(await storage.readBytes('missing')).toBeNull();
  });

  it('delegates to the host primitive when in sandbox', async () => {
    const hostWrite = vi.fn().mockResolvedValue(undefined);
    const hostRead = vi.fn().mockResolvedValue(new Uint8Array([9]));
    const storage = createSessionStorage({
      inSandbox: true,
      host: { writeBytes: hostWrite, readBytes: hostRead },
    });
    await storage.writeBytes('k', new Uint8Array([9]));
    expect(hostWrite).toHaveBeenCalledWith('k', new Uint8Array([9]));
    const got = await storage.readBytes('k');
    expect(hostRead).toHaveBeenCalledWith('k');
    expect(Array.from(got!)).toEqual([9]);
  });
});
