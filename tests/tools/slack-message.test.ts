import { describe, it, expect } from 'vitest';
import { SlackMessageTool } from '../../src/tools/slack_message.js';
import { ToolExecutionError } from '../../src/errors/tool-errors.js';

describe('SlackMessageTool', () => {
  it('validates tool schema and required fields', () => {
    expect(SlackMessageTool.NAME).toBe('slack_message');
    expect(SlackMessageTool.INPUT_SCHEMA.required).toContain('channel');
    expect(SlackMessageTool.INPUT_SCHEMA.required).toContain('text');
  });

  it('formats and simulates message dispatch in dryRun mode', async () => {
    const result = await SlackMessageTool.execute({
      channel: '#deployments',
      text: 'Release v2.0 deployed successfully :rocket:',
      dryRun: true
    });

    expect(result.status).toBe('SIMULATED');
    expect(result.channel).toBe('#deployments');
    expect(result.messageId).toMatch(/^sim-/);
    expect(result.deliveryNote).toContain('verified successfully');
    expect(result.timestamp).toBeDefined();
  });

  it('throws ToolExecutionError on missing channel or empty text', async () => {
    await expect(
      SlackMessageTool.execute({
        channel: '',
        text: 'hello'
      })
    ).rejects.toThrow(ToolExecutionError);

    await expect(
      SlackMessageTool.execute({
        channel: '#general',
        text: '   '
      })
    ).rejects.toThrow(ToolExecutionError);
  });
});
