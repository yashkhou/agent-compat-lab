#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const json = process.argv.includes('--json');
const clients = {
  codex: ['AGENTS.md', '.codex'],
  claude: ['CLAUDE.md', '.claude'],
  gemini: ['GEMINI.md', '.gemini'],
  opencode: ['AGENTS.md', 'opencode.json', '.opencode']
};
const exists = p => fs.existsSync(path.join(root, p));
const read = p => exists(p) && fs.statSync(path.join(root,p)).isFile() ? fs.readFileSync(path.join(root,p),'utf8') : '';
const findings = [];
const add = (severity, code, message, files=[]) => findings.push({severity,code,message,files});

const agentFiles = ['AGENTS.md','CLAUDE.md','GEMINI.md'].filter(exists);
if (!agentFiles.length) add('warning','NO_AGENT_INSTRUCTIONS','No recognized repository-level agent instruction file found.');
for (const file of agentFiles) {
  const text = read(file);
  if (text.length > 24000) add('warning','CONTEXT_HEAVY',`${file} is ${text.length} characters; large always-on instructions can waste context.`,[file]);
  if (/sudo\s|rm\s+-rf|--force\b|git\s+reset\s+--hard/i.test(text)) add('error','DANGEROUS_INSTRUCTION',`${file} contains destructive or privileged command guidance.`,[file]);
}
if (exists('AGENTS.md') && exists('CLAUDE.md')) {
  const a = read('AGENTS.md').toLowerCase(), c = read('CLAUDE.md').toLowerCase();
  const pairs = [['npm','pnpm'],['pnpm','yarn'],['npm','yarn']];
  for (const [x,y] of pairs) if ((a.includes(x)&&c.includes(y)) || (a.includes(y)&&c.includes(x))) add('warning','CLIENT_DRIFT','AGENTS.md and CLAUDE.md appear to reference different package-manager workflows.',['AGENTS.md','CLAUDE.md']);
}
const detected = Object.fromEntries(Object.entries(clients).map(([name,markers]) => [name, markers.some(exists)]));
const supported = Object.values(detected).filter(Boolean).length;
if (supported === 1) add('info','SINGLE_CLIENT','Repository appears configured for only one supported coding-agent client.');

const mcpFiles = ['.mcp.json','mcp.json','.vscode/mcp.json'].filter(exists);
for (const file of mcpFiles) {
  const text = read(file);
  if (/api[_-]?key|token|secret|password/i.test(text) && /["']\s*:\s*["'][^"'${}]{8,}["']/i.test(text)) add('error','POSSIBLE_INLINE_SECRET',`${file} may contain an inline credential.`,[file]);
  try { JSON.parse(text); } catch { add('error','INVALID_JSON',`${file} is not valid JSON.`,[file]); }
}

const weights = {error:20,warning:8,info:2};
const penalty = findings.reduce((n,f)=>n+(weights[f.severity]||0),0);
const score = Math.max(0,100-penalty);
const report = {root,score,detected,agentFiles,mcpFiles,findings};
if (json) console.log(JSON.stringify(report,null,2));
else {
  console.log(`Agent Compat: ${score}/100`);
  console.log(`Clients: ${Object.entries(detected).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none'}`);
  for (const f of findings) console.log(`${f.severity.toUpperCase()} ${f.code}: ${f.message}`);
}
process.exit(findings.some(f=>f.severity==='error') ? 1 : 0);
