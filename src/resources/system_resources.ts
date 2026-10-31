import * as os from 'node:os';
import type { ResourceDefinition, ResourceResult } from '../connectors/connector.js';

export class SystemResourceProvider {
  public static listResources(): ResourceDefinition[] {
    return [
      {
        uri: 'system://info',
        name: 'System Architecture & Host Info',
        description: 'Detailed platform, release, hostname, and CPU specifications.',
        mimeType: 'application/json'
      },
      {
        uri: 'system://metrics',
        name: 'Real-time System Metrics',
        description: 'Current memory allocation, load average, and process uptime.',
        mimeType: 'application/json'
      },
      {
        uri: 'system://environment',
        name: 'Runtime Environment Details',
        description: 'Node.js version, platform, architecture, and sanitized runtime flags.',
        mimeType: 'application/json'
      }
    ];
  }

  public static readResource(uri: string): ResourceResult {
    switch (uri) {
      case 'system://info':
        return {
          uri,
          mimeType: 'application/json',
          contents: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  platform: os.platform(),
                  type: os.type(),
                  release: os.release(),
                  architecture: os.arch(),
                  hostname: os.hostname(),
                  cpuCount: os.cpus().length,
                  cpuModel: os.cpus()[0]?.model ?? 'unknown'
                },
                null,
                2
              )
            }
          ]
        };

      case 'system://metrics':
        return {
          uri,
          mimeType: 'application/json',
          contents: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  uptimeSeconds: os.uptime(),
                  totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
                  freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
                  usedMemoryPercentage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
                  loadAverage: os.loadavg()
                },
                null,
                2
              )
            }
          ]
        };

      case 'system://environment':
        return {
          uri,
          mimeType: 'application/json',
          contents: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  nodeVersion: process.version,
                  platform: process.platform,
                  pid: process.pid,
                  memoryUsageMB: {
                    rss: Math.round(process.memoryUsage().rss / (1024 * 1024)),
                    heapTotal: Math.round(process.memoryUsage().heapTotal / (1024 * 1024)),
                    heapUsed: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
                  }
                },
                null,
                2
              )
            }
          ]
        };

      default:
        throw new Error(`Resource URI "${uri}" not found in system provider.`);
    }
  }
}
