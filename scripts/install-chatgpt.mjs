#!/usr/bin/env node
/**
 * install-chatgpt.mjs — CLI tool to install OmniLoop-MCP into ChatGPT Desktop.
 *
 * ChatGPT Desktop (as of 2026) supports MCP servers via its settings.
 * The config format mirrors Claude Desktop but uses a different file location.
 *
 * Usage:
 *   node scripts/install-chatgpt.mjs
 *   node scripts/install-chatgpt.mjs --dry-run
 *   node scripts/install-chatgpt.mjs --name my-gateway
 */

import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST_INDEX = join(ROOT, 'dist', 'index.js');
const DEFAULT_CONFIG = join(ROOT, 'config', 'omniloop.yaml');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const nameArg = args.find((a) => a.startsWith('--name='))?.split('=')[1] ?? 'omniloop';
const configArg = args.find((a) => a.startsWith('--config='))?.split('=')[1] ?? DEFAULT_CONFIG;

function getChatGPTConfigPath() {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'ChatGPT', 'mcp_servers.json');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'ChatGPT', 'mcp_servers.json');
    case 'linux':
      return join(home, '.config', 'chatgpt', 'mcp_servers.json');
    default:
      console.error('❌ Unsupported OS:', platform());
      process.exit(1);
  }
}

function main() {
  console.log('\n🔌 OmniLoop-MCP — ChatGPT Desktop Installer\n');

  if (!existsSync(DIST_INDEX)) {
    console.error('❌ dist/index.js not found. Run "npm run build" first.');
    process.exit(1);
  }

  const configPath = resolve(configArg);
  const chatgptConfigPath = getChatGPTConfigPath();
  console.log('📍 ChatGPT Desktop config:', chatgptConfigPath);

  let chatgptConfig = {};
  if (existsSync(chatgptConfigPath)) {
    try {
      chatgptConfig = JSON.parse(readFileSync(chatgptConfigPath, 'utf-8'));
    } catch { /* ignore */ }
  } else if (!isDryRun) {
    mkdirSync(chatgptConfigPath.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true });
  }

  const omniloopEntry = {
    type: 'stdio',
    command: 'node',
    args: [DIST_INDEX],
    env: {
      OMNILOOP_CONFIG: configPath,
      NODE_ENV: 'production'
    }
  };

  const merged = {
    ...chatgptConfig,
    mcpServers: {
      ...(chatgptConfig.mcpServers ?? {}),
      [nameArg]: omniloopEntry
    }
  };

  const output = JSON.stringify(merged, null, 2) + '\n';

  if (isDryRun) {
    console.log('\n🔍 DRY RUN — would write to:', chatgptConfigPath);
    console.log(output);
  } else {
    writeFileSync(chatgptConfigPath, output, 'utf-8');
    console.log('\n✅ OmniLoop installed into ChatGPT Desktop!');
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Edit config/omniloop.yaml — add your downstream MCP servers');
    console.log('   2. Set required env vars (GITHUB_TOKEN, etc.)');
    console.log('   3. Restart ChatGPT Desktop');
    console.log('   4. Enable OmniLoop in ChatGPT → Settings → Integrations → MCP');
  }
}

main();
