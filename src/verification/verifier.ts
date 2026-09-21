/**
 * Verifier — validates tool call results against success criteria.
 *
 * Built-in verifiers:
 *   - isSuccess: result.isError === false
 *   - hasText: result.content contains non-empty text
 *   - matchesPattern: result text matches a regex
 *   - customFn: caller-provided predicate
 *
 * The verifier interface is intentionally simple — complex verification
 * logic belongs in the VerificationLoop, not here.
 */

import type { ToolResult } from '../connectors/connector.js';

export type VerificationStatus = 'pass' | 'fail';

export interface VerificationOutcome {
  status: VerificationStatus;
  /** Human-readable explanation of the verdict */
  reason: string;
  /** The result that was verified */
  result: ToolResult;
}

/** A verifier is a function that inspects a ToolResult and returns pass/fail */
export type VerifierFn = (result: ToolResult) => VerificationOutcome;

// ── Built-in verifiers ────────────────────────────────────────────────────────

/** Pass if tool did not report an error */
export function isSuccess(): VerifierFn {
  return (result) => ({
    status: result.isError ? 'fail' : 'pass',
    reason: result.isError ? 'Tool reported isError=true' : 'Tool succeeded',
    result
  });
}

/** Pass if result contains at least one non-empty text content item */
export function hasText(): VerifierFn {
  return (result) => {
    const hasContent = result.content.some(
      (c) => c.type === 'text' && typeof c.text === 'string' && c.text.trim().length > 0
    );
    return {
      status: hasContent ? 'pass' : 'fail',
      reason: hasContent ? 'Result contains text content' : 'Result has no text content',
      result
    };
  };
}

/** Pass if result text matches the given regular expression */
export function matchesPattern(pattern: RegExp): VerifierFn {
  return (result) => {
    const text = result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n');

    const matches = pattern.test(text);
    return {
      status: matches ? 'pass' : 'fail',
      reason: matches
        ? `Result matches pattern ${pattern.source}`
        : `Result does not match pattern ${pattern.source}`,
      result
    };
  };
}

/** Compose multiple verifiers — all must pass */
export function allOf(...verifiers: VerifierFn[]): VerifierFn {
  return (result) => {
    for (const v of verifiers) {
      const outcome = v(result);
      if (outcome.status === 'fail') return outcome;
    }
    return { status: 'pass', reason: 'All verifiers passed', result };
  };
}
