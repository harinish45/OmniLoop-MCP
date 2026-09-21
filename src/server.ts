import { SystemMetricsTool } from './tools/system_metrics.js';
import { TaskRunnerTool } from './tools/task_runner.js';


export class OmniLoopMCPServer {
  private registeredTools = new Map<string, Function>();

  constructor() {
    this.registeredTools.set(SystemMetricsTool.NAME, SystemMetricsTool.execute);
    this.registeredTools.set(TaskRunnerTool.NAME, TaskRunnerTool.execute);
  }

  public listTools() {
    return [
      {
        name: SystemMetricsTool.NAME,
        description: SystemMetricsTool.DESCRIPTION
      },
      {
        name: TaskRunnerTool.NAME,
        description: TaskRunnerTool.DESCRIPTION
      }
    ];
  }

  public handleCallTool(name: string, args?: any) {
    const handler = this.registeredTools.get(name);
    if (!handler) {
      throw new Error(`Tool ${name} not found in OmniLoop registry.`);
    }
    return handler(args);
  }
}
