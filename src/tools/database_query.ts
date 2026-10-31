import { createRequire } from 'node:module';
import type { ToolInputSchema } from '../connectors/connector.js';
import { DatabaseQueryError, ToolExecutionError } from '../errors/tool-errors.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('database-query');

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const sqliteModule = req('node:sqlite');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const DatabaseSyncCtor: new (path: string) => any = sqliteModule.DatabaseSync;

export interface DatabaseQueryArgs {
  readonly query: string;
  readonly params?: unknown[];
  readonly databaseId?: string;
  readonly resetDatabase?: boolean;
}

export interface DatabaseQueryResult {
  readonly databaseId: string;
  readonly rowCount: number;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly tableFormatted: string;
  readonly changes?: number;
}

export class DatabaseQueryTool {
  public static readonly NAME = 'database_query';
  public static readonly DESCRIPTION = 'Execute SQL queries against in-memory SQLite database sessions with tabular result formatting.';

  private static readonly sessions = new Map<string, any>();

  public static readonly INPUT_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'SQL statement to execute (DDL, DML, or DQL query).'
      },
      params: {
        type: 'array',
        description: 'Positional parameters to bind to prepared SQL query.'
      },
      databaseId: {
        type: 'string',
        description: 'Session identifier for the in-memory SQLite database (default "default").'
      },
      resetDatabase: {
        type: 'boolean',
        description: 'Whether to reset and wipe the database session before executing (default false).'
      }
    },
    required: ['query']
  };

  public static execute(rawArgs: unknown): DatabaseQueryResult {
    const args = this.validateArgs(rawArgs);
    const databaseId = args.databaseId ?? 'default';

    if (args.resetDatabase) {
      this.closeSession(databaseId);
    }

    const db = this.getOrCreateSession(databaseId);
    const trimmed = args.query.trim();

    logger.debug({ databaseId, query: trimmed }, 'Executing SQL statement');

    try {
      const isSelect = /^(SELECT|PRAGMA|EXPLAIN|WITH)/i.test(trimmed);

      if (isSelect) {
        return this.executeSelect(db, databaseId, trimmed, args.params);
      }

      return this.executeMutation(db, databaseId, trimmed, args.params);
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ databaseId, query: trimmed, error: msg }, 'Database query error');
      throw new DatabaseQueryError(trimmed, msg);
    }
  }

  public static closeSession(databaseId: string): void {
    const existing = this.sessions.get(databaseId);
    if (existing) {
      try {
        existing.close();
      } catch {
        // ignore close error
      }
      this.sessions.delete(databaseId);
      logger.info({ databaseId }, 'Database session closed');
    }
  }

  public static closeAllSessions(): void {
    for (const key of this.sessions.keys()) {
      this.closeSession(key);
    }
  }

  private static getOrCreateSession(databaseId: string): any {
    let session = this.sessions.get(databaseId);
    if (!session) {
      session = new DatabaseSyncCtor(':memory:');
      this.sessions.set(databaseId, session);
      logger.info({ databaseId }, 'Created new in-memory SQLite session');
    }
    return session;
  }

  private static validateArgs(rawArgs: unknown): DatabaseQueryArgs {
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new ToolExecutionError('database_query', 'ERR_INVALID_ARGS', 'Database query arguments must be an object');
    }
    const input = rawArgs as Record<string, unknown>;
    const query = typeof input['query'] === 'string' ? input['query'].trim() : '';
    if (!query) {
      throw new ToolExecutionError('database_query', 'ERR_EMPTY_QUERY', 'SQL query is required and cannot be empty');
    }

    return {
      query,
      params: Array.isArray(input['params']) ? input['params'] : undefined,
      databaseId: typeof input['databaseId'] === 'string' ? input['databaseId'] : undefined,
      resetDatabase: input['resetDatabase'] === true
    };
  }

  private static executeSelect(
    db: any,
    databaseId: string,
    query: string,
    params?: unknown[]
  ): DatabaseQueryResult {
    const stmt = db.prepare(query);
    const rawRows = (params && params.length ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];
    const columns = rawRows.length > 0 ? Object.keys(rawRows[0] ?? {}) : [];
    const tableFormatted = this.formatTable(columns, rawRows);

    return {
      databaseId,
      rowCount: rawRows.length,
      columns,
      rows: rawRows,
      tableFormatted
    };
  }

  private static executeMutation(
    db: any,
    databaseId: string,
    query: string,
    params?: unknown[]
  ): DatabaseQueryResult {
    if (params && params.length > 0) {
      const stmt = db.prepare(query);
      const runResult = stmt.run(...params);
      const changes = typeof runResult?.changes === 'number' ? runResult.changes : 0;
      return {
        databaseId,
        rowCount: 0,
        columns: [],
        rows: [],
        tableFormatted: `Query executed successfully. Rows affected: ${changes}`,
        changes
      };
    }

    db.exec(query);
    return {
      databaseId,
      rowCount: 0,
      columns: [],
      rows: [],
      tableFormatted: 'Query executed successfully.'
    };
  }

  private static formatTable(columns: string[], rows: Record<string, unknown>[]): string {
    if (columns.length === 0 || rows.length === 0) {
      return '(0 rows returned)';
    }

    const header = `| ${columns.join(' | ')} |`;
    const separator = `|${columns.map(() => '---').join('|')}|`;
    const dataLines = rows.map((row) => {
      const cells = columns.map((col) => {
        const val = row[col];
        return val === null ? 'NULL' : val === undefined ? '' : String(val);
      });
      return `| ${cells.join(' | ')} |`;
    });

    return [header, separator, ...dataLines].join('\n');
  }
}
