import { describe, it, expect, beforeEach } from 'vitest';
import { RbacManager } from '../../src/policy/rbac.js';

describe('RbacManager', () => {
  const rbac = new RbacManager();

  beforeEach(() => {
    rbac.registerTenant({
      tenantId: 'tenant-dev',
      role: 'operator'
    });
    rbac.registerTenant({
      tenantId: 'tenant-ro',
      role: 'readonly'
    });
    rbac.registerTenant({
      tenantId: 'tenant-guest',
      role: 'guest'
    });
  });

  it('allows admin full critical permissions and wildcard execution', () => {
    const admin = rbac.getTenant('default');
    const check = rbac.canExecuteTool(admin, 'database.drop_table', 'critical');
    expect(check.allowed).toBe(true);
  });

  it('allows operator up to high risk, but denies critical', () => {
    const op = rbac.getTenant('tenant-dev');
    const allowHigh = rbac.canExecuteTool(op, 'git.delete_branch', 'high');
    expect(allowHigh.allowed).toBe(true);

    const denyCritical = rbac.canExecuteTool(op, 'database.drop_table', 'critical');
    expect(denyCritical.allowed).toBe(false);
    expect(denyCritical.reason).toContain('max allowed risk');
  });

  it('restricts readonly role to low risk read tools', () => {
    const ro = rbac.getTenant('tenant-ro');

    const allowRead = rbac.canExecuteTool(ro, 'files.read_file', 'low');
    expect(allowRead.allowed).toBe(true);

    const denyWrite = rbac.canExecuteTool(ro, 'files.write_file', 'medium');
    expect(denyWrite.allowed).toBe(false);
  });

  it('restricts guest role to whitelist tools only', () => {
    const guest = rbac.getTenant('tenant-guest');

    expect(rbac.canExecuteTool(guest, 'ping', 'low').allowed).toBe(true);
    expect(rbac.canExecuteTool(guest, 'files.read_file', 'low').allowed).toBe(false);
  });
});
