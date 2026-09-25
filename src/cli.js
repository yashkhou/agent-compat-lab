#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyzeRepository } from './analyze.js';
import { toSarif } from './sarif.js';
import { buildCapabilityManifest } from './manifest.js';

function usage() {
  return `Agent Compat Lab\n\nUsage:\n  agent-compat [repo] [--json]\n  agent-compat [repo] --sarif [file]\n  agent-compat [repo] --format text|json|sarif|manifest [--output file]
  agent-compat [repo] --manifest [file]\n\nOptions:\n  --json               Alias for --format json\n  --sarif [file]       Emit SARIF; optional file path\n  --manifest [file]    Emit machine-readable agent capability manifest
  --format <format>    text, json, sarif, or manifest\n  --output <file>      Write report to a file\n  --fail-on <level>    error (default) or warning\n  --help               Show this help\n`;
}

function parseArgs(argv) {
  const options = {
    root: '.',
    format: 'text',
    output: null,
    failOn: 'error'
  };
  let rootSet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    if (arg === '--json') {
      options.format = 'json';
      continue;
    }
    if (arg === '--manifest') {
      options.format = 'manifest';
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { options.output = next; i += 1; }
      continue;
    }
    if (arg === '--sarif') {
      options.format = 'sarif';
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        options.output = next;
        i += 1;
      }
      continue;
    }
    if (arg === '--format') {
      options.format = argv[++i] || '';
      continue;
    }
    if (arg === '--output') {
      options.output = argv[++i] || null;
      continue;
    }
    if (arg === '--fail-on') {
      options.failOn = argv[++i] || '';
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    if (rootSet) throw new Error(`Unexpected argument: ${arg}`);
    options.root = arg;
    rootSet = true;
  }
  if (!['text', 'json', 'sarif', 'manifest'].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  if (!['error', 'warning'].includes(options.failOn)) {
    throw new Error(`Unsupported fail level: ${options.failOn}`);
  }
  return options;
}

function renderText(report) {
  const clients = Object.entries(report.detected)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ') || 'none';
  const lines = [
    `Agent Compat: ${report.score}/100`,
    `Clients: ${clients}`,
    `Relevant files: ${report.inventory.relevantFiles.length}`
  ];
  for (const finding of report.findings) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  }
  return `${lines.join('\n')}\n`;
}

function render(report, format) {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (format === 'sarif') return `${JSON.stringify(toSarif(report), null, 2)}\n`;
  if (format === 'manifest') return `${JSON.stringify(buildCapabilityManifest(report), null, 2)}\n`;
  return renderText(report);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}

if (options.help) {
  process.stdout.write(usage());
  process.exit(0);
}

const report = analyzeRepository(options.root);
const output = render(report, options.format);

if (options.output) {
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
} else {
  process.stdout.write(output);
}

const hasError = report.findings.some(finding => finding.severity === 'error');
const hasWarning = report.findings.some(finding => finding.severity === 'warning');
const shouldFail = options.failOn === 'warning' ? hasError || hasWarning : hasError;
process.exit(shouldFail ? 1 : 0);
