import { describe, it, expect } from 'vitest';
import { HitlGate } from '../../src/security/hitl-gate.js';

describe('HitlGate', () => {
  it('auto-approves non-gated risk levels', async () => {
    const gate = new HitlGate({
      enabled: true,
      requiredForRisks: ['critical']
    });

    const res = await gate.checkApproval({
      toolName: 'read_data',
      args: {},
      riskLevel: 'low',
      traceId: 'tr-1'
    });

    expect(res.approved).toBe(true);
  });

  it('blocks critical operations when unconfirmed', async () => {
    const gate = new HitlGate({
      enabled: true,
      requiredForRisks: ['critical']
    });

    const res = await gate.checkApproval({
      toolName: 'drop_database',
      args: {},
      riskLevel: 'critical',
      traceId: 'tr-2'
    });

    expect(res.approved).toBe(false);
    expect(res.reason).toContain('requires operator confirmation');
  });

  it('approves critical operations when valid one-time token is provided', async () => {
    const gate = new HitlGate({
      enabled: true,
      requiredForRisks: ['critical'],
      tokenTtlSeconds: 60
    });

    const token = gate.issueToken('drop_database');
    expect(token).toContain('hitl_');

    // 1st use succeeds
    const res1 = await gate.checkApproval({
      toolName: 'drop_database',
      args: {},
      riskLevel: 'critical',
      traceId: 'tr-3'
    }, token);
    expect(res1.approved).toBe(true);

    // Replay of same token fails (single-use)
    const res2 = await gate.checkApproval({
      toolName: 'drop_database',
      args: {},
      riskLevel: 'critical',
      traceId: 'tr-4'
    }, token);
    expect(res2.approved).toBe(false);
  });

  it('delegates to custom approval handler when registered', async () => {
    let promptSeen = false;
    const gate = new HitlGate({
      enabled: true,
      requiredForRisks: ['high']
    }, (req) => {
      promptSeen = true;
      return req.toolName === 'permitted_action';
    });

    const denied = await gate.checkApproval({
      toolName: 'forbidden_action',
      args: {},
      riskLevel: 'high',
      traceId: 'tr-5'
    });
    expect(denied.approved).toBe(false);
    expect(promptSeen).toBe(true);

    const approved = await gate.checkApproval({
      toolName: 'permitted_action',
      args: {},
      riskLevel: 'high',
      traceId: 'tr-6'
    });
    expect(approved.approved).toBe(true);
  });
});
