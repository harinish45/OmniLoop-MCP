/**
 * Provenance — cryptographic signing and attestation of MCP tool results.
 * Guarantees that tool outputs received by agents were processed by OmniLoop
 * and have not been altered or injected in transit.
 */

import { createHmac } from 'crypto';
import type { ToolResult } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('provenance');

export interface ProvenanceConfig {
  enabled: boolean;
  /** Secret key used for HMAC-SHA256 signing */
  signingSecret: string;
  /** Header or meta property name */
  gatewayId: string;
}

export const DEFAULT_PROVENANCE_CONFIG: ProvenanceConfig = {
  enabled: true,
  signingSecret: 'omniloop-provenance-default-key-change-in-production',
  gatewayId: 'omniloop-v4'
};

export interface ProvenanceAttestation {
  gateway: string;
  traceId: string;
  toolName: string;
  timestamp: number;
  signature: string;
}

export class ProvenanceSigner {
  private readonly config: ProvenanceConfig;

  constructor(config: Partial<ProvenanceConfig> = {}) {
    this.config = { ...DEFAULT_PROVENANCE_CONFIG, ...config };
  }

  /**
   * Sign a tool result and embed cryptographic attestation.
   */
  signResult(result: ToolResult, toolName: string, traceId: string): ToolResult {
    if (!this.config.enabled) {
      return result;
    }

    const timestamp = Date.now();
    const signature = this.computeSignature(result.content, toolName, traceId, timestamp);

    const attestation: ProvenanceAttestation = {
      gateway: this.config.gatewayId,
      traceId,
      toolName,
      timestamp,
      signature
    };

    // Attach attestation as structured text block or meta
    const updatedContent = [
      ...result.content,
      {
        type: 'text' as const,
        text: `\n<!-- OMNILOOP_PROVENANCE: ${JSON.stringify(attestation)} -->`
      }
    ];

    return {
      ...result,
      content: updatedContent
    };
  }

  /**
   * Verify an attestation against the content and parameters.
   */
  verifyAttestation(
    rawContent: unknown,
    attestation: ProvenanceAttestation
  ): boolean {
    const expected = this.computeSignature(
      rawContent,
      attestation.toolName,
      attestation.traceId,
      attestation.timestamp
    );
    return expected === attestation.signature;
  }

  private computeSignature(
    content: unknown,
    toolName: string,
    traceId: string,
    timestamp: number
  ): string {
    const hmac = createHmac('sha256', this.config.signingSecret);
    const serialized = JSON.stringify({ content, toolName, traceId, timestamp });
    return hmac.update(serialized).digest('hex');
  }
}
