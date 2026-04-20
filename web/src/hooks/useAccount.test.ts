import { describe, test, expect } from 'vitest';
import { devAccounts, aliceAccount, DEV_USER_INDEX, getAliceSigner } from './useAccount';

describe('account exports', () => {
	test('DEV_USER_INDEX points at Bob, not Alice', () => {
		expect(DEV_USER_INDEX).toBe(1);
		expect(devAccounts[DEV_USER_INDEX].name).toBe('Bob');
	});

	test('aliceAccount is devAccounts[0]', () => {
		expect(aliceAccount.name).toBe('Alice');
		expect(aliceAccount.address).toBe(devAccounts[0].address);
	});

	test("getAliceSigner returns Alice's PAPI signer", () => {
		expect(getAliceSigner()).toBe(devAccounts[0].signer);
	});
});
