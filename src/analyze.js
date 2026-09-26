import path from 'node:path';
import {
  CLIENT_PROFILES,
  INSTRUCTION_NAMES,
  ROOT_CONFIG_PATHS,
  STANDALONE_MCP_PATHS,
  VERSION,
  clientsForInstructionName
} from './profiles.js';
import { walkRepository, readText } from './utils.js';
import { buildPrecedenceModel } from './precedence.js';
import {
  validateInstructions,
  validateSkills,
  validateStandaloneMcp,
  validateClientConfigs,
  validateAgentPlugin
} from './validators.js';

const WEIGHTS = { error: 20, warning: 8, info: 2 };

export function analyzeRepository(root, options = {}) {
  const resolvedRoot = path.resolve(root || '.');
  const scan = walkRepository(resolvedRoot, options);
  const fileSet = new Set(scan.files);
  const findings = [];
  const addFinding = (severity, code, message, files = [], client = null) => {
    findings.push({ severity, code, message, files, ...(client ? { client } : {}) });
  };

  const instructionFiles = scan.files
    .filter(file => INSTRUCTION_NAMES.has(path.posix.basename(file)))
    .map(file => ({
      path: file,
      text: readText(resolvedRoot, file),
      clients: clientsForInstructionName(path.posix.basename(file))
    }));
  const skillFiles = scan.files
    .filter(file => path.posix.basename(file) === 'SKILL.md')
    .map(file => ({ path: file, text: readText(resolvedRoot, file) }));
  const mcpFiles = scan.files.filter(file => STANDALONE_MCP_PATHS.has(file));
  const configFiles = scan.files.filter(file => ROOT_CONFIG_PATHS.has(file));

  if (scan.truncated) {
    addFinding('warning', 'SCAN_TRUNCATED', `Repository scan stopped after ${scan.files.length} files.`);
  }
  if (!instructionFiles.length) {
    addFinding('warning', 'NO_AGENT_INSTRUCTIONS', 'No recognized agent instruction file was found.');
  }

  validateInstructions(instructionFiles, addFinding);
  validateSkills(skillFiles, addFinding);
  validateStandaloneMcp(resolvedRoot, mcpFiles, addFinding);
  validateClientConfigs(resolvedRoot, configFiles, addFinding);
  const pluginFiles = scan.files.filter(file => path.posix.basename(file) === 'plugin.json');
  validateAgentPlugin(resolvedRoot, pluginFiles, fileSet, addFinding);
  const precedence = buildPrecedenceModel(instructionFiles, addFinding);

  const detected = {};
  for (const [client, profile] of Object.entries(CLIENT_PROFILES)) {
    detected[client] = instructionFiles.some(file => file.clients.includes(client))
      || profile.configPaths.some(file => fileSet.has(file))
      || profile.markerPrefixes.some(prefix => scan.files.some(file => file.startsWith(prefix)));
  }
  const supported = Object.values(detected).filter(Boolean).length;
  if (supported === 1) {
    addFinding('info', 'SINGLE_CLIENT', 'Repository appears configured for only one supported coding-agent client.');
  }

  const penalty = findings.reduce((total, finding) => total + (WEIGHTS[finding.severity] || 0), 0);
  const relevantFiles = [...new Set([
    ...instructionFiles.map(file => file.path),
    ...skillFiles.map(file => file.path),
    ...mcpFiles,
    ...configFiles,
    ...pluginFiles
  ])].sort();

  return {
    version: VERSION,
    root: resolvedRoot,
    score: Math.max(0, 100 - penalty),
    detected,
    agentFiles: instructionFiles.map(file => file.path),
    mcpFiles,
    inventory: {
      scannedFiles: scan.files.length,
      truncated: scan.truncated,
      instructionFiles: instructionFiles.map(file => file.path),
      skillFiles: skillFiles.map(file => file.path),
      mcpFiles,
      configFiles,
      pluginFiles,
      relevantFiles
    },
    precedence,
    findings
  };
}
