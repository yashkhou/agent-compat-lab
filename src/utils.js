import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache'
]);

export const normalizePath = value => value.split(path.sep).join('/');

export function walkRepository(root, { maxFiles = 30000 } = {}) {
  const files = [];
  const stack = ['.'];
  let truncated = false;
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let entries = [];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = normalizePath(path.join(relDir, entry.name)).replace(/^\.\//, '');
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(rel);
      if (files.length >= maxFiles) {
        truncated = true;
        stack.length = 0;
        break;
      }
    }
  }
  return { files: files.sort(), truncated };
}

export function readText(root, relPath) {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
  } catch {
    return '';
  }
}

function stripJsonComments(input) {
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripTrailingCommas(input) {
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (/\s/.test(input[j] || '')) j += 1;
      if (input[j] === '}' || input[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

export function parseFrontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return { data: null, body: text, error: 'missing' };
  const end = lines.slice(1).findIndex(line => line.trim() === '---');
  if (end < 0) return { data: null, body: '', error: 'unclosed' };
  const closeIndex = end + 1;
  const data = {};
  for (const raw of lines.slice(1, closeIndex)) {
    if (!raw.trim() || /^\s/.test(raw) || raw.trim().startsWith('#')) continue;
    const match = raw.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return { data, body: lines.slice(closeIndex + 1).join('\n').trim(), error: null };
}

export function pathDepth(relPath) {
  const dir = path.posix.dirname(normalizePath(relPath));
  return dir === '.' ? 0 : dir.split('/').length;
}

export function parentScope(relPath) {
  const dir = path.posix.dirname(normalizePath(relPath));
  return dir === '.' ? '.' : dir;
}

export function isScopeAncestor(parent, child) {
  if (parent === '.') return true;
  return child === parent || child.startsWith(`${parent}/`);
}
