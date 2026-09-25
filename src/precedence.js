import path from 'node:path';
import { CLIENT_PROFILES } from './profiles.js';
import { parentScope, pathDepth, isScopeAncestor } from './utils.js';

const MANAGERS = ['pnpm', 'yarn', 'bun', 'npm'];

export function extractPackageManagers(text) {
  const lower = text.toLowerCase();
  return MANAGERS.filter(name => new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`, 'i').test(lower));
}

function kindFor(file) {
  return path.posix.basename(file.path) === 'AGENTS.override.md' ? 'override' : 'base';
}

function nearestParent(nodes, node) {
  return nodes
    .filter(candidate => candidate.path !== node.path)
    .filter(candidate => candidate.depth < node.depth && isScopeAncestor(candidate.scope, node.scope))
    .sort((a, b) => b.depth - a.depth)[0] || null;
}

export function buildPrecedenceModel(instructionFiles, addFinding) {
  const model = {};
  for (const [client, profile] of Object.entries(CLIENT_PROFILES)) {
    const nodes = instructionFiles
      .filter(file => profile.instructionNames.includes(path.posix.basename(file.path)))
      .map(file => ({
        path: file.path,
        scope: parentScope(file.path),
        depth: pathDepth(file.path),
        kind: kindFor(file),
        text: file.text
      }))
      .sort((a, b) => a.depth - b.depth || a.scope.localeCompare(b.scope) || (a.kind === 'base' ? -1 : 1));

    model[client] = nodes.map(node => {
      const overrides = nodes
        .filter(candidate => candidate.path !== node.path)
        .filter(candidate => {
          if (candidate.depth < node.depth) return isScopeAncestor(candidate.scope, node.scope);
          return node.kind === 'override' && candidate.scope === node.scope && candidate.kind === 'base';
        })
        .map(candidate => candidate.path);
      return { path: node.path, scope: node.scope, kind: node.kind, overrides };
    });

    for (const node of nodes) {
      const parent = nearestParent(nodes, node);
      if (!parent) continue;
      const parentManagers = extractPackageManagers(parent.text);
      const childManagers = extractPackageManagers(node.text);
      if (parentManagers.length === 1 && childManagers.length === 1 && parentManagers[0] !== childManagers[0]) {
        addFinding(
          'warning',
          'SCOPED_INSTRUCTION_DRIFT',
          `${client} instructions switch package-manager guidance from ${parentManagers[0]} to ${childManagers[0]} in a narrower scope.`,
          [parent.path, node.path],
          client
        );
      }
    }
  }
  return model;
}
