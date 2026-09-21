/**
 * RBAC — Role-Based Access Control and capability scoping for multi-tenant MCP federation.
 */

import { createLogger } from '../observability/logging.js';

const logger = createLogger('rbac');

export type UserRole = 'admin' | 'operator' | 'analyst' | 'readonly' | 'guest';

export interface RolePermissions {
  allowedToolPatterns: string[];
  maxRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  canManageServers: boolean;
}

export const ROLE_DEFINITIONS: Record<UserRole, RolePermissions> = {
  admin: {
    allowedToolPatterns: ['*'],
    maxRiskLevel: 'critical',
    canManageServers: true
  },
  operator: {
    allowedToolPatterns: ['*'],
    maxRiskLevel: 'high',
    canManageServers: false
  },
  analyst: {
    allowedToolPatterns: ['read_*', 'get_*', 'list_*', 'search_*', 'describe_*', 'describe*'],
    maxRiskLevel: 'medium',
    canManageServers: false
  },
  readonly: {
    allowedToolPatterns: ['read_*', 'get_*', 'list_*', 'search_*'],
    maxRiskLevel: 'low',
    canManageServers: false
  },
  guest: {
    allowedToolPatterns: ['ping', 'echo', 'version'],
    maxRiskLevel: 'low',
    canManageServers: false
  }
};

const RISK_HIERARCHY: Record<'low' | 'medium' | 'high' | 'critical', number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export interface TenantContext {
  tenantId: string;
  role: UserRole;
  customAllowedTools?: string[];
}

export class RbacManager {
  private readonly tenantStore = new Map<string, TenantContext>();

  constructor() {
    // Default tenant for unauthenticated local stdio connections
    this.tenantStore.set('default', {
      tenantId: 'default',
      role: 'admin'
    });
  }

  /** Register or update a tenant */
  registerTenant(tenant: TenantContext): void {
    this.tenantStore.set(tenant.tenantId, tenant);
    logger.info({ tenantId: tenant.tenantId, role: tenant.role }, 'Tenant registered');
  }

  /** Lookup tenant context by ID or API key */
  getTenant(tenantId: string): TenantContext {
    return this.tenantStore.get(tenantId) ?? {
      tenantId: 'anonymous',
      role: 'readonly'
    };
  }

  /**
   * Check if a tenant has permission to invoke a tool with the specified risk level.
   */
  canExecuteTool(
    tenant: TenantContext,
    namespacedTool: string,
    toolRisk: 'low' | 'medium' | 'high' | 'critical'
  ): { allowed: boolean; reason?: string } {
    const roleDef = ROLE_DEFINITIONS[tenant.role] ?? ROLE_DEFINITIONS.readonly;

    // 1. Check risk level hierarchy
    const tenantMaxRiskScore = RISK_HIERARCHY[roleDef.maxRiskLevel];
    const toolRiskScore = RISK_HIERARCHY[toolRisk];

    if (toolRiskScore > tenantMaxRiskScore) {
      return {
        allowed: false,
        reason: `Role '${tenant.role}' max allowed risk is '${roleDef.maxRiskLevel}', but tool risk is '${toolRisk}'`
      };
    }

    // 2. Check tool pattern matching
    const patterns = [...roleDef.allowedToolPatterns, ...(tenant.customAllowedTools ?? [])];
    const matchesPattern = patterns.some((pat) => this.matchPattern(pat, namespacedTool));

    if (!matchesPattern) {
      return {
        allowed: false,
        reason: `Tool '${namespacedTool}' is not permitted for role '${tenant.role}'`
      };
    }

    return { allowed: true };
  }

  private matchPattern(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true;
    if (pattern === toolName) return true;

    // Check glob wildcards like "github.*" or "read_*"
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`, 'i');
    const bareName = toolName.includes('.') ? toolName.split('.')[1]! : toolName;

    return regex.test(toolName) || regex.test(bareName);
  }
}
