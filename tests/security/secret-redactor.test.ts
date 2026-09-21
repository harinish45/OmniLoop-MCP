import { describe, it, expect } from 'vitest';
import { SecretRedactor } from '../../src/security/secret-redactor.js';

describe('SecretRedactor', () => {
  const redactor = new SecretRedactor({ enabled: true });

  it('redacts AWS access keys', () => {
    const raw = 'Configured with AKIAIOSFODNN7EXAMPLE key';
    const redacted = redactor.redactString(raw);
    expect(redacted).toBe('Configured with [REDACTED:aws-access-key] key');
  });

  it('redacts GitHub personal access tokens', () => {
    const raw = 'Token is ghp_123456789012345678901234567890123456';
    const redacted = redactor.redactString(raw);
    expect(redacted).toBe('Token is [REDACTED:github-token]');
  });

  it('redacts OpenAI secret keys', () => {
    const raw = 'sk-abcdef12345678901234567890123456';
    const redacted = redactor.redactString(raw);
    expect(redacted).toBe('[REDACTED:openai-key]');
  });

  it('redacts bearer tokens', () => {
    const raw = 'Authorization: Bearer mySecretAccessToken1234567890';
    const redacted = redactor.redactString(raw);
    expect(redacted).toContain('[REDACTED:bearer-token]');
  });

  it('deeply redacts nested objects and arrays for logging', () => {
    const data = {
      user: 'alice',
      password: 'supersecretpassword123',
      credentials: {
        token: 'ghp_123456789012345678901234567890123456',
        items: ['AKIAIOSFODNN7EXAMPLE', 'normal-value']
      }
    };

    const result = redactor.redactForLogging(data) as any;
    expect(result.user).toBe('alice');
    expect(result.password).toBe('[REDACTED:sensitive-field]');
    expect(result.credentials.token).toBe('[REDACTED:sensitive-field]');
    expect(result.credentials.items[0]).toBe('[REDACTED:aws-access-key]');
    expect(result.credentials.items[1]).toBe('normal-value');
  });

  it('passes through unchanged when disabled', () => {
    const disabled = new SecretRedactor({ enabled: false });
    const raw = 'AKIAIOSFODNN7EXAMPLE';
    expect(disabled.redactString(raw)).toBe(raw);
  });
});
