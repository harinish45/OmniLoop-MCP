/**
 * Protocol — MCP protocol version and capability negotiation.
 * Declares what the OmniLoop Gateway supports as an MCP server.
 */

export const GATEWAY_NAME = 'OmniLoop Gateway';
export const GATEWAY_VERSION = '1.0.0';

/** MCP spec version this gateway targets */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

/** Server capabilities advertised to connecting LLM clients */
export const GATEWAY_CAPABILITIES = {
  tools: {
    /** We support dynamic tool lists via notifications/tools/list_changed */
    listChanged: true
  },
  resources: {
    listChanged: true
  },
  prompts: {
    listChanged: false
  }
} as const;
