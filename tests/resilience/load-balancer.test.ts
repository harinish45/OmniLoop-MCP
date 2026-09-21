import { describe, it, expect, beforeEach } from 'vitest';
import { ServerLoadBalancer } from '../../src/resilience/load-balancer.js';
import { ServerRegistry } from '../../src/registry/server-registry.js';
import type { MCPConnector, ToolDefinition } from '../../src/connectors/connector.js';

class MockConnector implements MCPConnector {
  constructor(public readonly serverId: string) {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  isConnected(): boolean { return true; }
  async ping(): Promise<boolean> { return true; }
  async listTools(): Promise<ToolDefinition[]> { return []; }
  async callTool() { return { content: [], isError: false }; }
  async listResources() { return []; }
  async readResource() { throw new Error('Not implemented'); }
  async listPrompts() { return []; }
  async getPrompt() { throw new Error('Not implemented'); }
}

describe('ServerLoadBalancer', () => {
  let registry: ServerRegistry;
  let balancer: ServerLoadBalancer;

  beforeEach(() => {
    registry = new ServerRegistry();
    balancer = new ServerLoadBalancer(registry);

    registry.register(new MockConnector('srv-1'));
    registry.register(new MockConnector('srv-2'));
    registry.setStatus('srv-1', 'healthy');
    registry.setStatus('srv-2', 'healthy');
  });

  it('balances requests using round-robin strategy', () => {
    balancer.registerPool({
      poolName: 'cluster',
      strategy: 'round-robin',
      serverIds: ['srv-1', 'srv-2']
    });

    const conn1 = balancer.selectConnector('cluster');
    const conn2 = balancer.selectConnector('cluster');
    const conn3 = balancer.selectConnector('cluster');

    expect(conn1.serverId).toBe('srv-1');
    expect(conn2.serverId).toBe('srv-2');
    expect(conn3.serverId).toBe('srv-1');
  });

  it('automatically fails over when primary server goes offline', () => {
    balancer.registerPool({
      poolName: 'failover-pool',
      strategy: 'failover',
      serverIds: ['srv-1', 'srv-2']
    });

    expect(balancer.selectConnector('failover-pool').serverId).toBe('srv-1');

    // Primary fails
    registry.setStatus('srv-1', 'offline');

    // Secondary automatically takes traffic
    expect(balancer.selectConnector('failover-pool').serverId).toBe('srv-2');
  });
});
