import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseQueryTool } from '../../src/tools/database_query.js';
import { DatabaseQueryError, ToolExecutionError } from '../../src/errors/tool-errors.js';

describe('DatabaseQueryTool', () => {
  const dbId = 'test-session';

  beforeEach(() => {
    DatabaseQueryTool.closeSession(dbId);
  });

  it('creates tables, inserts data, and retrieves structured tabular results', () => {
    // 1. Create table
    const createResult = DatabaseQueryTool.execute({
      databaseId: dbId,
      query: `CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL
      );`
    });
    expect(createResult.tableFormatted).toContain('successfully');

    // 2. Insert rows with prepared parameters
    const insertResult1 = DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'INSERT INTO products (id, name, price) VALUES (?, ?, ?);',
      params: [1, 'Laptop', 1299.99]
    });
    expect(insertResult1.changes).toBe(1);

    DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'INSERT INTO products (id, name, price) VALUES (?, ?, ?);',
      params: [2, 'Mechanical Keyboard', 149.50]
    });

    // 3. Select rows
    const selectResult = DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'SELECT * FROM products ORDER BY id ASC;'
    });

    expect(selectResult.rowCount).toBe(2);
    expect(selectResult.columns).toEqual(['id', 'name', 'price']);
    expect(selectResult.rows).toHaveLength(2);
    expect(selectResult.rows[0]).toEqual({ id: 1, name: 'Laptop', price: 1299.99 });
    expect(selectResult.rows[1]).toEqual({ id: 2, name: 'Mechanical Keyboard', price: 149.50 });

    // 4. Verify tabular format
    expect(selectResult.tableFormatted).toContain('| id | name | price |');
    expect(selectResult.tableFormatted).toContain('| Laptop |');
    expect(selectResult.tableFormatted).toContain('| Mechanical Keyboard |');
  });

  it('supports parameterized queries in SELECT', () => {
    DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'CREATE TABLE items (id INT, tag TEXT);'
    });
    DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'INSERT INTO items VALUES (10, ?), (20, ?);',
      params: ['alpha', 'beta']
    });

    const result = DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'SELECT * FROM items WHERE tag = ?;',
      params: ['alpha']
    });

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]?.['tag']).toBe('alpha');
  });

  it('isolates different database sessions by databaseId', () => {
    DatabaseQueryTool.execute({
      databaseId: 'db-a',
      query: "CREATE TABLE table_a (val TEXT); INSERT INTO table_a VALUES ('alpha');"
    });

    DatabaseQueryTool.execute({
      databaseId: 'db-b',
      query: "CREATE TABLE table_b (val TEXT); INSERT INTO table_b VALUES ('beta');"
    });

    // db-b should not have table_a
    expect(() => {
      DatabaseQueryTool.execute({
        databaseId: 'db-b',
        query: 'SELECT * FROM table_a;'
      });
    }).toThrow(DatabaseQueryError);

    DatabaseQueryTool.closeSession('db-a');
    DatabaseQueryTool.closeSession('db-b');
  });

  it('resets database when resetDatabase is set to true', () => {
    DatabaseQueryTool.execute({
      databaseId: dbId,
      query: 'CREATE TABLE persistent (x INT); INSERT INTO persistent VALUES (99);'
    });

    // Resetting session
    DatabaseQueryTool.execute({
      databaseId: dbId,
      resetDatabase: true,
      query: 'CREATE TABLE fresh (y INT);'
    });

    // Old table is gone
    expect(() => {
      DatabaseQueryTool.execute({
        databaseId: dbId,
        query: 'SELECT * FROM persistent;'
      });
    }).toThrow(DatabaseQueryError);
  });

  it('throws DatabaseQueryError on invalid SQL syntax', () => {
    expect(() => {
      DatabaseQueryTool.execute({
        databaseId: dbId,
        query: 'SELEKT * FORM non_existent_table;'
      });
    }).toThrow(DatabaseQueryError);
  });

  it('throws ToolExecutionError on empty query or invalid arguments', () => {
    expect(() => DatabaseQueryTool.execute({ query: '' })).toThrow(ToolExecutionError);
    expect(() => DatabaseQueryTool.execute(null)).toThrow(ToolExecutionError);
  });
});
