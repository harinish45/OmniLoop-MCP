import * as os from 'os';

export interface SystemMetrics {
  platform: string;
  architecture: string;
  uptimeSeconds: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  cpuCount: number;
  loadAverage: number[];
}

export class SystemMetricsTool {
  public static readonly NAME = 'get_system_metrics';
  public static readonly DESCRIPTION = 'Retrieve real-time host CPU, memory, and OS architecture metrics.';

  public static execute(): SystemMetrics {
    return {
      platform: os.platform(),
      architecture: os.arch(),
      uptimeSeconds: os.uptime(),
      totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg()
    };
  }
}
