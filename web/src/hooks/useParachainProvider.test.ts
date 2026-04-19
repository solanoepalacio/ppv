import { describe, test, expect } from 'vitest';
import { getParachainApi, getCurrentSigner } from './useParachainProvider';

describe('getParachainApi', () => {
  test('throws before provider is initialized', () => {
    expect(() => getParachainApi()).toThrowError('Parachain provider not initialized');
  });
});

describe('getCurrentSigner', () => {
  test('throws before provider is initialized', () => {
    expect(() => getCurrentSigner()).toThrowError('No signer — provider not initialized');
  });
});
