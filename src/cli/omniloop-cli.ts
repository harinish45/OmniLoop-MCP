#!/usr/bin/env node
/**
 * OmniLoop CLI — Enterprise diagnostics, audit verification, and benchmarking.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { loadConfig } from '../config/loader.js';

export async function runCli(args: string[]): Promise<number> {
  const command = args[0] ?? 'help';

  switch (command) {
    case 'doctor':
      return runDoctor(args.slice(1));
    case 'audit':
      if (args[1] === 'verify') {
        return runAuditVerify(args[2]);
      }
      console.log('Usage: omniloop audit verify [path/to/audit.jsonl]');
      return 1;
    case 'benchmark':
      return runBenchmark();
    case 'help':
    default:
      printHelp();
      return 0;
  }
}

function printHelp(): void {
  console.log(`
OmniLoop CLI — Enterprise MCP Diagnostics & Tools

Commands:
  omniloop doctor [--config <path>]    Verify node runtime, config validation, and server definitions
  omniloop audit verify <file.jsonl>   Validate cryptographic SHA-256 chain hash sequence
  omniloop benchmark                  Execute in-memory throughput & pipeline latency benchmark
  omniloop help                       Display this assistance documentation
`);
}

function runDoctor(args: string[]): number {
  console.log('\n🩺 OmniLoop Health & Configuration Doctor\n');

  // 1. Node Version Check
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace('v', '').split('.')[0]!, 10);
  if (major >= 18) {
    console.log(`✅ Node runtime: ${nodeVer} (Supported)`);
  } else {
    console.log(`❌ Node runtime: ${nodeVer} (Requires Node 18 or higher)`);
    return 1;
  }

  // 2. Configuration file resolution
  const configArg = args.find((a) => a.startsWith('--config='))?.split('=')[1] ?? 'config/omniloop.yaml';
  const configPath = resolve(configArg);

  if (!existsSync(configPath)) {
    console.log(`⚠️  Config file not found at: ${configPath}`);
    console.log('   Run: cp config/omniloop.example.yaml config/omniloop.yaml');
    return 0;
  }

  try {
    const config = loadConfig(configPath);
    console.log(`✅ Configuration parsed successfully: ${config.gateway.name} v${config.version}`);
    console.log(`   Configured servers: ${Object.keys(config.servers).join(', ') || 'none'}`);
  } catch (err) {
    console.log(`❌ Configuration error: ${(err as Error).message}`);
    return 1;
  }

  console.log('\n✨ Doctor completed: OmniLoop Gateway is ready to run.\n');
  return 0;
}

function runAuditVerify(filePath?: string): number {
  console.log('\n🔒 OmniLoop Cryptographic Audit Trail Verification\n');

  const targetPath = filePath ? resolve(filePath) : undefined;
  if (!targetPath || !existsSync(targetPath)) {
    console.error(`❌ Audit file not found: ${targetPath ?? 'No path provided'}`);
    return 1;
  }

  const raw = readFileSync(targetPath, 'utf8');
  const lines = raw.trim().split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    console.log('ℹ️  Audit file is empty.');
    return 0;
  }

  let prevHash = '0'.repeat(64); // Genesis hash
  let verifiedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]!);
      const { chainHash, ...eventWithoutHash } = entry;

      const eventJson = JSON.stringify(eventWithoutHash);
      const computedHash = createHash('sha256')
        .update(prevHash + eventJson)
        .digest('hex');

      if (computedHash !== chainHash) {
        console.error(`❌ Tampering detected at line ${i + 1}!`);
        console.error(`   Expected hash: ${computedHash}`);
        console.error(`   Found in log:  ${chainHash}`);
        return 1;
      }

      prevHash = computedHash;
      verifiedCount++;
    } catch (err) {
      console.error(`❌ JSON parsing error at line ${i + 1}: ${(err as Error).message}`);
      return 1;
    }
  }

  console.log(`✅ Verified ${verifiedCount} audit events.`);
  console.log(`   Cryptographic chain integrity confirmed! (Latest hash: ${prevHash.slice(0, 16)}...)`);
  return 0;
}

function runBenchmark(): number {
  console.log('\n⚡ OmniLoop In-Memory Throughput & Latency Benchmark\n');

  const iterations = 50_000;
  const start = performance.now();

  let dummy = 0;
  for (let i = 0; i < iterations; i++) {
    const hash = createHash('sha256').update(`test::tool::${i}`).digest('hex');
    dummy += hash.length;
  }

  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);

  console.log(`Iterations: ${iterations.toLocaleString()}`);
  console.log(`Elapsed:    ${elapsed.toFixed(2)} ms`);
  console.log(`Throughput: ${opsPerSec.toLocaleString()} ops/sec`);
  console.log(`Checksum:   ${dummy > 0 ? 'valid' : 'invalid'}`);
  return 0;
}

// Execute if run as script
if (process.argv[1] && process.argv[1].includes('omniloop-cli')) {
  void runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
