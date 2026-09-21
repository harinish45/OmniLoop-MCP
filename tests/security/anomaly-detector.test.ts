import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AnomalyDetector } from '../../src/security/anomaly-detector.js';

describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new AnomalyDetector({
      enabled: true,
      maxIdenticalCallsInWindow: 3,
      windowMs: 5000,
      maxEntropyThreshold: 5.5
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls below the loop threshold', () => {
    expect(detector.evaluate('files.read', { path: '/a' }).anomalous).toBe(false);
    expect(detector.evaluate('files.read', { path: '/a' }).anomalous).toBe(false);
  });

  it('detects and blocks runaway loop bombs with identical arguments', () => {
    detector.evaluate('files.read', { path: '/a' });
    detector.evaluate('files.read', { path: '/a' });

    // 3rd call within 5s window trips the anomaly detector
    const res = detector.evaluate('files.read', { path: '/a' });
    expect(res.anomalous).toBe(true);
    expect(res.reasons[0]).toContain('Runaway loop detected');
  });

  it('resets counter after window elapses', () => {
    detector.evaluate('files.read', { path: '/a' });
    detector.evaluate('files.read', { path: '/a' });

    // Advance past window (5s)
    vi.advanceTimersByTime(5001);

    // Call allowed again
    const res = detector.evaluate('files.read', { path: '/a' });
    expect(res.anomalous).toBe(false);
  });

  it('calculates Shannon entropy and detects high-entropy payloads', () => {
    // Normal English sentence has low entropy (~3-4)
    const normal = 'The quick brown fox jumps over the lazy dog and runs across the green field.';
    const lowEntropy = AnomalyDetector.calculateEntropy(normal);
    expect(lowEntropy).toBeLessThan(4.8);

    // Cryptographic / pseudo-random payload has high entropy (> 5.5)
    let randomBytesStr = '';
    for (let i = 0; i < 256; i++) {
      randomBytesStr += String.fromCharCode(Math.floor(Math.random() * 256));
    }
    const highEntropy = AnomalyDetector.calculateEntropy(randomBytesStr);
    expect(highEntropy).toBeGreaterThan(5.5);

    // Test evaluation
    const check = detector.evaluate('data.process', { payload: randomBytesStr });
    expect(check.anomalous).toBe(true);
    expect(check.reasons[0]).toContain('High entropy');
  });
});
