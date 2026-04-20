import { describe, test, expect } from 'vitest';
import {
  getParachainApi,
  getUserSigner,
  getUserAddress,
  getAliceSigner,
} from './useParachainProvider';
import { aliceAccount } from './useAccount';

describe('getParachainApi', () => {
  test('throws before provider is initialized', () => {
    expect(() => getParachainApi()).toThrowError('Parachain provider not initialized');
  });
});

describe('getUserSigner', () => {
  test('throws before provider is initialized', () => {
    expect(() => getUserSigner()).toThrowError('No user signer — provider not initialized');
  });
});

describe('getUserAddress', () => {
  test('returns null before provider is initialized', () => {
    expect(getUserAddress()).toBeNull();
  });
});

describe('getAliceSigner', () => {
  test('returns Alice signer synchronously, without provider init', () => {
    expect(getAliceSigner()).toBe(aliceAccount.signer);
  });
});
