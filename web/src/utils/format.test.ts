import { describe, test, expect } from 'vitest';
import { truncateAddress, formatDot } from './format';

describe('truncateAddress', () => {
  test('returns short addresses unchanged', () => {
    expect(truncateAddress('5GrwvaEF')).toBe('5GrwvaEF');
  });

  test('truncates address longer than 12 chars to first6…last6', () => {
    const addr = '5GrwvaEFAmGLuDfcUmFiKzMCaSjFp1KR7ABCDE';
    expect(truncateAddress(addr)).toBe('5Grwva…7ABCDE');
  });

  test('preserves exactly-12-char address', () => {
    expect(truncateAddress('123456789012')).toBe('123456789012');
  });
});

describe('formatDot', () => {
  test('converts 1 DOT (10^10 planck) to "1.00 DOT"', () => {
    expect(formatDot(10_000_000_000n)).toBe('1.00 DOT');
  });

  test('converts 0 planck to "0.00 DOT"', () => {
    expect(formatDot(0n)).toBe('0.00 DOT');
  });

  test('converts 2.5 DOT to "2.50 DOT"', () => {
    expect(formatDot(25_000_000_000n)).toBe('2.50 DOT');
  });

  test('rounds sub-cent planck amounts', () => {
    expect(formatDot(10_000_000_001n)).toBe('1.00 DOT');
  });
});
