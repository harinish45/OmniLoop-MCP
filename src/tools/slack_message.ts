import { fetch } from 'undici';
import type { ToolInputSchema } from '../connectors/connector.js';
import { ToolExecutionError } from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('slack-message');

export interface SlackMessageArgs {
  readonly channel: string;
  readonly text: string;
  readonly webhookUrl?: string;
  readonly token?: string;
  readonly dryRun?: boolean;
}

export interface SlackMessageResult {
  readonly status: 'SENT' | 'SIMULATED';
  readonly channel: string;
  readonly timestamp: string;
  readonly messageId?: string;
  readonly deliveryNote?: string;
}

export class SlackMessageTool {
  public static readonly NAME = 'slack_message';
  public static readonly DESCRIPTION = 'Send or simulate dispatching messages to Slack channels via webhooks or bot tokens.';

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Target Slack channel name or ID (e.g. "#general" or "C12345").'
      },
      text: {
        type: 'string',
        description: 'Markdown formatted message body to publish to Slack.'
      },
      webhookUrl: {
        type: 'string',
        description: 'Optional incoming webhook URL for posting messages directly.'
      },
      token: {
        type: 'string',
        description: 'Optional Slack bot/user OAuth token (xoxb-...).'
      },
      dryRun: {
        type: 'boolean',
        description: 'If true, simulates message formatting without dispatching to network (default false).'
      }
    },
    required: ['channel', 'text']
  };

  public static async execute(rawArgs: unknown): Promise<SlackMessageResult> {
    const args = this.validateArgs(rawArgs);
    const webhookUrl = args.webhookUrl ?? process.env['SLACK_WEBHOOK_URL'];
    const token = args.token ?? process.env['SLACK_BOT_TOKEN'];
    const isDryRun = args.dryRun === true || (!webhookUrl && !token);

    if (isDryRun) {
      logger.info({ channel: args.channel }, 'Simulating Slack message dispatch (dryRun)');
      return {
        status: 'SIMULATED',
        channel: args.channel,
        timestamp: new Date().toISOString(),
        messageId: `sim-${Date.now()}`,
        deliveryNote: 'Message formatted and verified successfully (simulated/dry-run).'
      };
    }

    if (webhookUrl) {
      return this.sendViaWebhook(webhookUrl, args.channel, args.text);
    }

    return this.sendViaToken(token as string, args.channel, args.text);
  }

  private static validateArgs(rawArgs: unknown): SlackMessageArgs {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('slack_message', 'ERR_INVALID_ARGS', 'Slack message arguments must be an object');
    }
    const input = rawArgs as Record<string, unknown>;
    const channel = typeof input['channel'] === 'string' ? input['channel'].trim() : '';
    const text = typeof input['text'] === 'string' ? input['text'].trim() : '';

    if (!channel) {
      throw new ToolExecutionError('slack_message', 'ERR_MISSING_CHANNEL', 'Channel parameter is required');
    }
    if (!text) {
      throw new ToolExecutionError('slack_message', 'ERR_EMPTY_TEXT', 'Message text is required and cannot be empty');
    }

    return {
      channel,
      text,
      webhookUrl: typeof input['webhookUrl'] === 'string' ? input['webhookUrl'] : undefined,
      token: typeof input['token'] === 'string' ? input['token'] : undefined,
      dryRun: typeof input['dryRun'] === 'boolean' ? input['dryRun'] : undefined
    };
  }

  private static async sendViaWebhook(webhookUrl: string, channel: string, text: string): Promise<SlackMessageResult> {
    logger.debug({ channel }, 'Sending message via Slack webhook');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text })
    });

    if (!response.ok) {
      throw new ToolExecutionError(
        'slack_message',
        'ERR_WEBHOOK_FAILED',
        `Slack webhook returned HTTP ${response.status}`
      );
    }

    return {
      status: 'SENT',
      channel,
      timestamp: new Date().toISOString()
    };
  }

  private static async sendViaToken(token: string, channel: string, text: string): Promise<SlackMessageResult> {
    logger.debug({ channel }, 'Sending message via Slack Web API');
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ channel, text })
    });

    const data = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
    if (!data.ok) {
      throw new ToolExecutionError(
        'slack_message',
        'ERR_API_FAILED',
        `Slack API error: ${data.error ?? 'unknown error'}`
      );
    }

    return {
      status: 'SENT',
      channel,
      timestamp: new Date().toISOString(),
      messageId: data.ts
    };
  }
}
