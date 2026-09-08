export interface ToolResult {
  status: 'SUCCESS' | 'ERROR';
  output: string;
  timestamp: string;
}

export class TaskRunnerTool {
  public static readonly NAME = 'execute_safe_diagnostic';
  public static readonly DESCRIPTION = 'Run an approved read-only diagnostic verification task.';

  public static execute(taskType: string): ToolResult {
    const validTasks = ['ping', 'healthcheck', 'version'];
    if (!validTasks.includes(taskType)) {
      return {
        status: 'ERROR',
        output: `Task ${taskType} rejected by OmniLoop security guardrail. Allowed: ${validTasks.join(', ')}`,
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'SUCCESS',
      output: `Diagnostic task ${taskType} executed successfully. Status: OPERATIONAL.`,
      timestamp: new Date().toISOString()
    };
  }
}
