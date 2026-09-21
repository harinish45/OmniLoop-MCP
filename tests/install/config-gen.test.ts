import { describe, it, expect } from 'vitest';
import { ConfigGen, claudeDesktopConfigPath, chatgptDesktopConfigPath } from '../../src/install/config-gen.js';
import { resolve } from 'path';

describe('ConfigGen', () => {
  const dummyGateway = resolve('dist/index.js');
  const dummyConfig = resolve('config/omniloop.yaml');

  const gen = new ConfigGen({
    gatewayPath: dummyGateway,
    configPath: dummyConfig,
    serverName: 'omniloop-test',
    extraEnv: { CUSTOM_VAR: 'xyz' }
  });

  it('generates compliant Claude Desktop configuration', () => {
    const claudeConfig = gen.forClaude() as any;
    expect(claudeConfig['omniloop-test']).toBeDefined();
    expect(claudeConfig['omniloop-test'].command).toBe('node');
    expect(claudeConfig['omniloop-test'].args).toEqual([dummyGateway]);
    expect(claudeConfig['omniloop-test'].env.OMNILOOP_CONFIG).toBe(dummyConfig);
    expect(claudeConfig['omniloop-test'].env.CUSTOM_VAR).toBe('xyz');
  });

  it('generates compliant ChatGPT Desktop configuration', () => {
    const chatgptConfig = gen.forChatGPT() as any;
    expect(chatgptConfig['omniloop-test']).toBeDefined();
    expect(chatgptConfig['omniloop-test'].type).toBe('stdio');
    expect(chatgptConfig['omniloop-test'].command).toBe('node');
    expect(chatgptConfig['omniloop-test'].args).toEqual([dummyGateway]);
    expect(chatgptConfig['omniloop-test'].env.OMNILOOP_CONFIG).toBe(dummyConfig);
  });

  it('generates compliant Cursor configuration', () => {
    const cursorConfig = gen.forCursor() as any;
    expect(cursorConfig.mcpServers['omniloop-test']).toBeDefined();
    expect(cursorConfig.mcpServers['omniloop-test'].command).toBe('node');
  });

  it('detects platform config paths', () => {
    const claudePath = claudeDesktopConfigPath();
    expect(claudePath).toBeDefined();
    expect(claudePath).toContain('claude_desktop_config.json');

    const chatgptPath = chatgptDesktopConfigPath();
    expect(chatgptPath).toBeDefined();
    expect(chatgptPath).toContain('mcp_servers.json');
  });
});
