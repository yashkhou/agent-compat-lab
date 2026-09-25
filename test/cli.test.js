import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('src/cli.js');
const run = (dir, args = ['--json']) => spawnSync(
  process.execPath,
  [cli, dir, ...args],
  { encoding: 'utf8' }
);
const makeDir = () => mkdtempSync(path.join(tmpdir(), 'compat-'));
const put = (dir, rel, content) => {
  const target = path.join(dir, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

test('reports missing agent instructions without crashing', () => {
  const dir = makeDir();
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.ok(body.findings.some(finding => finding.code === 'NO_AGENT_INSTRUCTIONS'));
  assert.equal(body.inventory.instructionFiles.length, 0);
});

test('detects client drift and inline MCP credentials', () => {
  const dir = makeDir();
  put(dir, 'AGENTS.md', 'Use npm test.');
  put(dir, 'CLAUDE.md', 'Use pnpm test.');
  put(dir, '.mcp.json', JSON.stringify({
    mcpServers: {
      local: {
        command: 'node',
        args: ['server.js'],
        env: { token: 'abcdefghijklmnop' }
      }
    }
  }));
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.ok(body.findings.some(finding => finding.code === 'CLIENT_DRIFT'));
  assert.ok(body.findings.some(finding => finding.code === 'POSSIBLE_INLINE_SECRET'));
});

test('models nested instruction precedence and flags scoped workflow drift', () => {
  const dir = makeDir();
  put(dir, 'AGENTS.md', 'Use npm test at repository scope.');
  put(dir, 'packages/app/AGENTS.md', 'Use pnpm test in this package.');
  put(dir, 'packages/app/AGENTS.override.md', 'Package override instructions.');
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  const nested = body.precedence.codex.find(node => node.path === 'packages/app/AGENTS.md');
  const override = body.precedence.codex.find(node => node.path === 'packages/app/AGENTS.override.md');
  assert.ok(nested.overrides.includes('AGENTS.md'));
  assert.equal(override.kind, 'override');
  assert.ok(override.overrides.includes('packages/app/AGENTS.md'));
  assert.ok(body.findings.some(finding => finding.code === 'SCOPED_INSTRUCTION_DRIFT'));
});

test('validates SKILL.md frontmatter', () => {
  const dir = makeDir();
  put(dir, 'AGENTS.md', 'Use npm test.');
  put(dir, '.agents/skills/demo/SKILL.md', `---\nname: demo\n---\nDo the task.\n`);
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.ok(body.findings.some(finding => finding.code === 'SKILL_DESCRIPTION_MISSING'));
});

test('accepts OpenCode JSONC and validates local MCP shape', () => {
  const dir = makeDir();
  put(dir, 'AGENTS.md', 'Use npm test.');
  put(dir, '.opencode/opencode.jsonc', `{
    // OpenCode project config
    "mcp": {
      "local": {
        "type": "local",
        "command": ["node", "server.js"],
      },
    },
  }`);
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(body.detected.opencode, true);
  assert.ok(!body.findings.some(finding => finding.code === 'INVALID_CONFIG'));
  assert.ok(!body.findings.some(finding => finding.code.startsWith('OPENCODE_')));
});


test('validates Gemini MCP server maps', () => {
  const dir = makeDir();
  put(dir, 'GEMINI.md', 'Use npm test.');
  put(dir, '.gemini/settings.json', JSON.stringify({
    mcpServers: { docs: { args: ['server.js'] } }
  }));
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(body.detected.gemini, true);
  assert.ok(body.findings.some(finding => finding.code === 'MCP_SERVER_NO_TRANSPORT'));
});

test('emits SARIF 2.1.0 with rule and location data', () => {
  const dir = makeDir();
  put(dir, 'AGENTS.md', 'Use npm test, but never run git reset --hard.');
  const result = run(dir, ['--format', 'sarif']);
  const sarif = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'Agent Compat Lab');
  const finding = sarif.runs[0].results.find(item => item.ruleId === 'DANGEROUS_INSTRUCTION');
  assert.equal(finding.level, 'error');
  assert.equal(finding.locations[0].physicalLocation.artifactLocation.uri, 'AGENTS.md');
});

test('writes SARIF to an explicit output path', () => {
  const dir = makeDir();
  const output = path.join(dir, 'reports', 'compat.sarif');
  put(dir, 'AGENTS.md', 'Use npm test.');
  const result = run(dir, ['--sarif', output]);
  assert.equal(result.status, 0);
  const sarif = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(sarif.version, '2.1.0');
});


test('validates Claude Code project permission shape', () => {
  const dir = makeDir();
  put(dir, 'CLAUDE.md', 'Use npm test.');
  put(dir, '.claude/settings.json', JSON.stringify({
    permissions: { allow: 'Bash(npm test)' }
  }));
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(body.detected.claude, true);
  assert.ok(body.findings.some(finding => finding.code === 'CLAUDE_PERMISSION_LIST_INVALID'));
});

test('validates Codex MCP TOML sections', () => {
  const dir = makeDir();
  put(dir, 'AGENTS.md', 'Use npm test.');
  put(dir, '.codex/config.toml', `[mcp_servers.docs]\nenabled = true\n`);
  const result = run(dir);
  const body = JSON.parse(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(body.detected.codex, true);
  assert.ok(body.findings.some(finding => finding.code === 'CODEX_MCP_TRANSPORT_MISSING'));
});
