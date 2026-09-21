import { describe, it, expect } from 'vitest';
import { ProvenanceSigner } from '../../src/security/provenance.js';
import type { ToolResult } from '../../src/connectors/connector.js';

describe('ProvenanceSigner', () => {
  const signer = new ProvenanceSigner({
    enabled: true,
    signingSecret: 'test-secret-key-12345',
    gatewayId: 'omniloop-test'
  });

  const baseResult: ToolResult = {
    content: [{ type: 'text', text: 'Clean data output' }],
    isError: false
  };

  it('embeds cryptographic attestation into tool result', () => {
    const signed = signer.signResult(baseResult, 'files.read', 'tr-100');

    expect(signed.content.length).toBe(2);
    const lastItem = signed.content[1] as any;
    expect(lastItem.text).toContain('OMNILOOP_PROVENANCE:');
    expect(lastItem.text).toContain('"gateway":"omniloop-test"');
  });

  it('verifies valid attestation successfully', () => {
    const signed = signer.signResult(baseResult, 'files.read', 'tr-100');
    const attestationMatch = (signed.content[1] as any).text.match(/OMNILOOP_PROVENANCE:\s*(\{.*\})/);
    expect(attestationMatch).toBeTruthy();

    const attestation = JSON.parse(attestationMatch[1]);
    const isValid = signer.verifyAttestation(baseResult.content, attestation);
    expect(isValid).toBe(true);
  });

  it('detects tampering when content is modified', () => {
    const signed = signer.signResult(baseResult, 'files.read', 'tr-100');
    const attestationMatch = (signed.content[1] as any).text.match(/OMNILOOP_PROVENANCE:\s*(\{.*\})/);
    const attestation = JSON.parse(attestationMatch[1]);

    const tamperedContent = [{ type: 'text', text: 'Modified fraudulent content' }];
    const isValid = signer.verifyAttestation(tamperedContent, attestation);
    expect(isValid).toBe(false);
  });
});
