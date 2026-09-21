import { describe, it, expect } from 'vitest';
import { SchemaSynthesizer } from '../../src/resilience/schema-synthesizer.js';

describe('SchemaSynthesizer', () => {
  const schema = {
    type: 'object',
    properties: {
      active: { type: 'boolean' },
      count: { type: 'number' },
      tags: { type: 'array' },
      name: { type: 'string' }
    }
  };

  it('coerces string representations of boolean values', () => {
    const raw = { active: 'true' };
    const coerced = SchemaSynthesizer.coerceArguments(raw, schema);
    expect(coerced['active']).toBe(true);

    expect(SchemaSynthesizer.coerceArguments({ active: 'false' }, schema)['active']).toBe(false);
    expect(SchemaSynthesizer.coerceArguments({ active: '1' }, schema)['active']).toBe(true);
    expect(SchemaSynthesizer.coerceArguments({ active: '0' }, schema)['active']).toBe(false);
  });

  it('coerces string numbers to numeric type', () => {
    const raw = { count: '42' };
    const coerced = SchemaSynthesizer.coerceArguments(raw, schema);
    expect(coerced['count']).toBe(42);
  });

  it('coerces comma-separated strings to arrays', () => {
    const raw = { tags: 'frontend, backend, mcp' };
    const coerced = SchemaSynthesizer.coerceArguments(raw, schema);
    expect(coerced['tags']).toEqual(['frontend', 'backend', 'mcp']);
  });

  it('preserves already compliant values without alteration', () => {
    const raw = { active: false, count: 100, tags: ['a', 'b'], name: 'test' };
    const coerced = SchemaSynthesizer.coerceArguments(raw, schema);
    expect(coerced).toEqual(raw);
  });
});
