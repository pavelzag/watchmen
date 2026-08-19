import { encrypt, decrypt } from './encryption';

describe('Encryption Utilities', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('throws an error if AUTH_SECRET is not set', () => {
        delete process.env.AUTH_SECRET;
        expect(() => encrypt('test-secret')).toThrow('AUTH_SECRET env var is required for key encryption');
    });

    it('encrypts and decrypts a string successfully', () => {
        process.env.AUTH_SECRET = 'this-is-a-very-secret-key-that-needs-to-be-long-enough';

        const plaintext = 'sensitive-data-123';
        const encrypted = encrypt(plaintext);

        // Ensure the encrypted text is not the same as the plaintext
        expect(encrypted).not.toBe(plaintext);

        // Ensure it follows the salt:iv:authTag:ciphertext format (4 parts, legacy is 3)
        expect([3, 4]).toContain(encrypted.split(':').length);

        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
    });

    it('throws an error if attempting to decrypt invalid format', () => {
        process.env.AUTH_SECRET = 'this-is-a-very-secret-key-that-needs-to-be-long-enough';
        expect(() => decrypt('invalid-format')).toThrow('Invalid encrypted format');
    });
});
