#!/usr/bin/env node
/**
 * install-claude.mjs — CLI tool to install OmniLoop-MCP into Claude Desktop.
 *
 * Usage:
 *   node scripts/install-claude.mjs
 *   node scripts/install-claude.mjs --dry-run
 *   node scripts/install-claude.mjs --name my-gateway --config /path/to/omniloop.yaml
 */

import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST_INDEX = join(ROOT, 'dist', 'index.js');
const DEFAULT_CONFIG = join(ROOT, 'config', 'omniloop.yaml');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const nameArg = args.find((a) => a.startsWith('--name='))?.split('=')[1] ?? 'omniloop';
const configArg = args.find((a) => a.startsWith('--config='))?.split('=')[1] ?? DEFAULT_CONFIG;

// ── Claude Desktop config path ────────────────────────────────────────────────

function getClaudeConfigPath() {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'linux':
      return join(home, '.config', 'claude', 'claude_desktop_config.json');
    default:
      console.error('❌ Unsupported OS:', platform());
      process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('\n🔌 OmniLoop-MCP — Claude Desktop Installer\n');

  // 1. Check dist/index.js exists
  if (!existsSync(DIST_INDEX)) {
    console.error('❌ dist/index.js not found. Run "npm run build" first.');
    process.exit(1);
  }
  console.log('✅ Build found:', DIST_INDEX);

  // 2. Check config exists
  const configPath = resolve(configArg);
  if (!existsSync(configPath)) {
    // Generate a minimal default config
    console.log('⚠️  Config not found. Creating minimal config at:', configPath);
    if (!isDryRun) {
      const examplePath = join(ROOT, 'config', 'omniloop.example.yaml');
      if (existsSync(examplePath)) {
        const example = readFileSync(examplePath, 'utf-8');
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, example, 'utf-8');
        console.log('✅ Default config created from example');
      } else {
        console.error('❌ omniloop.example.yaml not found. Cannot create default config.');
        process.exit(1);
      }
    }
  } else {
    console.log('✅ Config found:', configPath);
  }

  // 3. Get Claude Desktop config path
  const claudeConfigPath = getClaudeConfigPath();
  console.log('📍 Claude Desktop config:', claudeConfigPath);

  // 4. Load existing config
  let claudeConfig = {};
  if (existsSync(claudeConfigPath)) {
    try {
      claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
      console.log('✅ Existing Claude config loaded');
    } catch {
      console.warn('⚠️  Existing config could not be parsed — will overwrite');
    }
  } else {
    console.log('ℹ️  No existing Claude config found — will create new');
    if (!isDryRun) {
      mkdirSync(claudeConfigPath.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true });
    }
  }

  // 5. Build the OmniLoop entry
  const omniloopEntry = {
    command: 'node',
    args: [DIST_INDEX],
    env: {
      OMNILOOP_CONFIG: configPath,
      NODE_ENV: 'production'
    }
  };

  // 6. Merge
  const merged = {
    ...claudeConfig,
    mcpServers: {
      ...(claudeConfig.mcpServers ?? {}),
      [nameArg]: omniloopEntry
    }
  };

  // 7. Write
  const output = JSON.stringify(merged, null, 2) + '\n';

  if (isDryRun) {
    console.log('\n🔍 DRY RUN — would write to:', claudeConfigPath);
    console.log(output);
  } else {
    writeFileSync(claudeConfigPath, output, 'utf-8');
    console.log('\n✅ OmniLoop installed into Claude Desktop!');
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Edit config/omniloop.yaml — add your downstream MCP servers');
    console.log('   2. Set required env vars (GITHUB_TOKEN, etc.)');
    console.log('   3. Restart Claude Desktop');
    console.log('   4. OmniLoop will appear as "omniloop" in Claude\'s tool list');
    console.log('');
    console.log('🧪 Test the gateway: node dist/index.js');
  }
}

main();
