import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeRepository } from '../src/analyze.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, '..', 'corpus', 'repos.json'), 'utf8'));
const json = process.argv.includes('--json');
const keep = process.argv.includes('--keep');
const git = process.env.GIT_BINARY || 'git';

function runGit(args, cwd) {
  const result = spawnSync(git, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function cloneSparse(entry, destination) {
  runGit(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', entry.url, destination]);
  runGit(['-C', destination, 'sparse-checkout', 'init', '--no-cone']);
  runGit(['-C', destination, 'sparse-checkout', 'set', '--no-cone', ...entry.sparse]);
  runGit(['-C', destination, 'checkout', '--quiet']);
}

const root = mkdtempSync(path.join(tmpdir(), 'agent-compat-corpus-'));
const results = [];
let failed = false;

try {
  for (const entry of manifest) {
    const destination = path.join(root, entry.repo.replace('/', '__'));
    try {
      cloneSparse(entry, destination);
      const report = analyzeRepository(destination);
      const missingFiles = entry.expectedFiles.filter(file => !report.inventory.relevantFiles.includes(file));
      const missingClients = entry.expectedClients.filter(client => !report.detected[client]);
      const parseFailures = report.findings.filter(finding =>
        ['INVALID_CONFIG', 'SKILL_FRONTMATTER_MISSING', 'SKILL_FRONTMATTER_UNCLOSED'].includes(finding.code)
      );
      const ok = !missingFiles.length && !missingClients.length && !parseFailures.length;
      if (!ok) failed = true;
      results.push({
        repo: entry.repo,
        ok,
        score: report.score,
        relevantFiles: report.inventory.relevantFiles,
        missingFiles,
        missingClients,
        parseFailures: parseFailures.map(finding => finding.code),
        findings: report.findings.map(finding => finding.code)
      });
    } catch (error) {
      failed = true;
      results.push({ repo: entry.repo, ok: false, error: error.message });
    }
  }
} finally {
  if (!keep) rmSync(root, { recursive: true, force: true });
}

if (json) {
  process.stdout.write(`${JSON.stringify({ root: keep ? root : null, results }, null, 2)}\n`);
} else {
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS ${result.repo} score=${result.score} files=${result.relevantFiles.length}`);
    } else {
      console.log(`FAIL ${result.repo} ${result.error || JSON.stringify({
        missingFiles: result.missingFiles,
        missingClients: result.missingClients,
        parseFailures: result.parseFailures
      })}`);
    }
  }
  if (keep) console.log(`Kept corpus at ${root}`);
}

process.exit(failed ? 1 : 0);
