import type { PromptDefinition } from '../connectors/connector.js';

export interface PromptMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: {
    readonly type: 'text';
    readonly text: string;
  };
}

export interface PromptGetResult {
  readonly description?: string;
  readonly messages: PromptMessage[];
}

export class DiagnosticPromptProvider {
  public static listPrompts(): PromptDefinition[] {
    return [
      {
        name: 'code_review',
        description: 'Comprehensive code review prompt focusing on security, performance, and best practices.',
        arguments: [
          { name: 'code', description: 'The source code snippet to review.', required: true },
          { name: 'language', description: 'Programming language of the snippet.', required: false }
        ]
      },
      {
        name: 'diagnostic_check',
        description: 'Guided diagnostic verification prompt for host health and MCP tools.',
        arguments: [
          { name: 'component', description: 'Subsystem or tool name to verify.', required: false }
        ]
      },
      {
        name: 'sql_generator',
        description: 'Generate high-performance, injection-safe SQL queries from schema definitions.',
        arguments: [
          { name: 'schema', description: 'Table schema or DDL definitions.', required: true },
          { name: 'goal', description: 'Target data retrieval or aggregation objective.', required: true }
        ]
      }
    ];
  }

  public static getPrompt(name: string, rawArgs?: Record<string, unknown>): PromptGetResult {
    const args = rawArgs ?? {};

    switch (name) {
      case 'code_review': {
        const code = String(args['code'] ?? '');
        const language = String(args['language'] ?? 'code');
        return {
          description: 'Perform senior code review on the provided snippet.',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Review the following ${language} code for correctness, performance, edge-case coverage, and security:\n\n\`\`\`${language}\n${code}\n\`\`\``
              }
            }
          ]
        };
      }

      case 'diagnostic_check': {
        const component = String(args['component'] ?? 'all');
        return {
          description: 'Run diagnostic health assessment.',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please perform a system diagnostic check on component "${component}" and summarize operational readiness.`
              }
            }
          ]
        };
      }

      case 'sql_generator': {
        const schema = String(args['schema'] ?? '');
        const goal = String(args['goal'] ?? '');
        return {
          description: 'Generate optimized SQL query.',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Given the following schema:\n${schema}\n\nGenerate an optimized, parameterized SQL query to achieve: ${goal}`
              }
            }
          ]
        };
      }

      default:
        throw new Error(`Prompt "${name}" not found in diagnostic prompt provider.`);
    }
  }
}
