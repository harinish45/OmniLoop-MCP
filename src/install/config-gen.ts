/**
 * ConfigGen — generates desktop app configuration snippets for installing
 * OmniLoop-MCP into Claude Desktop, ChatGPT Desktop, Cursor, and Windsurf.
 *
 * Usage (programmatic):
 *   const gen = new ConfigGen({ gatewayPath: distIndexPath, configPath });
 *   gen.forClaude()  → JSON object to merge into claude_desktop_config.json
 *   gen.forChatGPT() → JSON object for ChatGPT Desktop's mcp_servers.json
 */

import { resolve, join } from 'path';
import { homedir, platform } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('config-gen');

export interface ConfigGenOptions {
  /** Absolute path to dist/index.js */
  gatewayPath: string;
  /** Absolute path to omniloop.yaml */
  configPath: string;
  /** Name to register under in desktop app config */
  serverName?: string;
  /** Extra environment variables to forward */
  extraEnv?: Record<string, string>;
}

// ── Platform-specific config file paths ──────────────────────────────────────

export function claudeDesktopConfigPath(): string | undefined {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'linux':
      return join(home, '.config', 'claude', 'claude_desktop_config.json');
    default:
      return undefined;
  }
}

export function chatgptDesktopConfigPath(): string | undefined {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'ChatGPT', 'mcp_servers.json');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'ChatGPT', 'mcp_servers.json');
    case 'linux':
      return join(home, '.config', 'chatgpt', 'mcp_servers.json');
    default:
      return undefined;
  }
}

// ── Config snippets ───────────────────────────────────────────────────────────

export class ConfigGen {
  private readonly opts: Required<ConfigGenOptions>;

  constructor(opts: ConfigGenOptions) {
    this.opts = {
      serverName: 'omniloop',
      extraEnv: {},
      ...opts,
      gatewayPath: resolve(opts.gatewayPath),
      configPath: resolve(opts.configPath)
    };
  }

  /**
   * Returns the mcpServers entry for claude_desktop_config.json.
   */
  forClaude(): Record<string, unknown> {
    return {
      [this.opts.serverName]: {
        command: 'node',
        args: [this.opts.gatewayPath],
        env: {
          OMNILOOP_CONFIG: this.opts.configPath,
          NODE_ENV: 'production',
          ...this.opts.extraEnv
        }
      }
    };
  }

  /**
   * Returns the entry for ChatGPT Desktop's mcp_servers.json.
   * ChatGPT uses the same stdio format as Claude for local MCP servers.
   */
  forChatGPT(): Record<string, unknown> {
    return {
      [this.opts.serverName]: {
        type: 'stdio',
        command: 'node',
        args: [this.opts.gatewayPath],
        env: {
          OMNILOOP_CONFIG: this.opts.configPath,
          ...this.opts.extraEnv
        }
      }
    };
  }

  /**
   * Returns the .cursor/mcp.json entry for Cursor IDE.
   */
  forCursor(): Record<string, unknown> {
    return {
      mcpServers: {
        [this.opts.serverName]: {
          command: 'node',
          args: [this.opts.gatewayPath],
          env: {
            OMNILOOP_CONFIG: this.opts.configPath,
            ...this.opts.extraEnv
          }
        }
      }
    };
  }

  /**
   * Returns the Windsurf MCP config entry.
   */
  forWindsurf(): Record<string, unknown> {
    return {
      [this.opts.serverName]: {
        command: 'node',
        args: [this.opts.gatewayPath],
        env: {
          OMNILOOP_CONFIG: this.opts.configPath,
          ...this.opts.extraEnv
        }
      }
    };
  }

  /**
   * Install into Claude Desktop config file.
   * Merges the new server entry into the existing config.
   * @returns true if successfully installed, false if config path not found
   */
  installToClaude(): boolean {
    const configPath = claudeDesktopConfigPath();
    if (!configPath) {
      logger.warn('Claude Desktop config path not determined for this OS');
      return false;
    }
    return this.mergeIntoConfig(configPath, 'mcpServers', this.forClaude());
  }

  /**
   * Install into ChatGPT Desktop config file.
   */
  installToChatGPT(): boolean {
    const configPath = chatgptDesktopConfigPath();
    if (!configPath) {
      logger.warn('ChatGPT Desktop config path not determined for this OS');
      return false;
    }
    return this.mergeIntoConfig(configPath, 'mcpServers', this.forChatGPT());
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private mergeIntoConfig(
    configFilePath: string,
    key: string,
    newEntries: Record<string, unknown>
  ): boolean {
    let existing: Record<string, unknown> = {};

    if (existsSync(configFilePath)) {
      try {
        existing = JSON.parse(readFileSync(configFilePath, 'utf-8')) as Record<string, unknown>;
      } catch {
        logger.warn({ configFilePath }, 'Existing config could not be parsed — will overwrite');
      }
    } else {
      // Create parent directories
      mkdirSync(configFilePath.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true });
    }

    const currentSection = (existing[key] as Record<string, unknown>) ?? {};
    existing[key] = { ...currentSection, ...newEntries };

    writeFileSync(configFilePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    logger.info({ configFilePath, key, entries: Object.keys(newEntries) }, 'Config installed');
    return true;
  }
}
