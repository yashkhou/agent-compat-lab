import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const cli = path.resolve('src/cli.js');
const run = dir => spawnSync(process.execPath,[cli,dir,'--json'],{encoding:'utf8'});

test('reports missing agent instructions',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'compat-'));
  const r=run(dir), body=JSON.parse(r.stdout);
  assert.equal(body.score,92);
  assert.equal(body.findings[0].code,'NO_AGENT_INSTRUCTIONS');
});

test('detects client drift and inline MCP secrets',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'compat-'));
  writeFileSync(path.join(dir,'AGENTS.md'),'Use npm test');
  writeFileSync(path.join(dir,'CLAUDE.md'),'Use pnpm test');
  writeFileSync(path.join(dir,'.mcp.json'),'{"token":"abcdefghijklmnop"}');
  const r=run(dir), body=JSON.parse(r.stdout);
  assert.equal(r.status,1);
  assert.ok(body.findings.some(x=>x.code==='CLIENT_DRIFT'));
  assert.ok(body.findings.some(x=>x.code==='POSSIBLE_INLINE_SECRET'));
});
