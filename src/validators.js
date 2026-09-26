import { parseFrontmatter, parseJsonc, readText } from './utils.js';
import { extractPackageManagers } from './precedence.js';

const DANGEROUS = /\bsudo\s|\brm\s+-rf\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bchmod\s+-R\s+777\b/i;
const SECRET_KEY = /(api[_-]?key|token|secret|password|credential)/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function looksLikePlaceholder(value) {
  return !value
    || /^\$\{[^}]+\}$/.test(value)
    || /^\$[A-Z0-9_]+$/.test(value)
    || /^env:/i.test(value)
    || /^(changeme|example|placeholder|your[_-])/i.test(value);
}

function scanSecrets(value, file, addFinding, keyPath = []) {
  if (!isObject(value) && !Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...keyPath, key];
    if (typeof child === 'string' && SECRET_KEY.test(key) && child.length >= 8 && !looksLikePlaceholder(child)) {
      addFinding('error', 'POSSIBLE_INLINE_SECRET',
        `${file} appears to contain a literal credential at ${nextPath.join('.')}; use environment indirection instead.`, [file]);
    } else if (isObject(child) || Array.isArray(child)) {
      scanSecrets(child, file, addFinding, nextPath);
    }
  }
}

function validateMcpServerMap(map, file, addFinding, client = null) {
  if (!isObject(map)) {
    addFinding('error', 'MCP_SCHEMA_INVALID', `${file} must define MCP servers as an object map.`, [file], client);
    return;
  }
  for (const [name, server] of Object.entries(map)) {
    if (!isObject(server)) {
      addFinding('error', 'MCP_SERVER_INVALID', `${file} MCP server ${name} must be an object.`, [file], client);
      continue;
    }
    const command = server.command;
    const url = server.url ?? server.httpUrl;
    if (command === undefined && url === undefined) {
      addFinding('warning', 'MCP_SERVER_NO_TRANSPORT', `${file} MCP server ${name} has neither command nor URL transport.`, [file], client);
    }
    if (command !== undefined && !(typeof command === 'string' || (Array.isArray(command) && command.every(v => typeof v === 'string')))) {
      addFinding('error', 'MCP_COMMAND_INVALID', `${file} MCP server ${name} has an invalid command value.`, [file], client);
    }
    if (server.args !== undefined && !(Array.isArray(server.args) && server.args.every(v => typeof v === 'string'))) {
      addFinding('error', 'MCP_ARGS_INVALID', `${file} MCP server ${name} args must be an array of strings.`, [file], client);
    }
    if (url !== undefined && typeof url !== 'string') {
      addFinding('error', 'MCP_URL_INVALID', `${file} MCP server ${name} URL must be a string.`, [file], client);
    }
    if (server.env !== undefined && !isObject(server.env)) {
      addFinding('error', 'MCP_ENV_INVALID', `${file} MCP server ${name} env must be an object.`, [file], client);
    }
  }
}

function parseConfig(text, file, addFinding, client, jsonc = false) {
  try {
    const parsed = jsonc ? parseJsonc(text) : JSON.parse(text);
    if (!isObject(parsed)) {
      addFinding('error', 'CONFIG_SCHEMA_INVALID', `${file} must contain a top-level object.`, [file], client);
      return null;
    }
    scanSecrets(parsed, file, addFinding);
    return parsed;
  } catch (error) {
    addFinding('error', 'INVALID_CONFIG', `${file} could not be parsed: ${error.message.split('\n')[0]}`, [file], client);
    return null;
  }
}

export function validateInstructions(instructionFiles, addFinding) {
  for (const file of instructionFiles) {
    if (file.text.length > 24000) {
      addFinding('warning', 'CONTEXT_HEAVY', `${file.path} is ${file.text.length} characters; large always-on instructions consume context.`, [file.path]);
    }
    if (DANGEROUS.test(file.text)) {
      addFinding('error', 'DANGEROUS_INSTRUCTION', `${file.path} contains destructive or privileged command guidance.`, [file.path]);
    }
  }
  const roots = instructionFiles.filter(file => !file.path.includes('/'));
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const left = extractPackageManagers(roots[i].text);
      const right = extractPackageManagers(roots[j].text);
      if (left.length === 1 && right.length === 1 && left[0] !== right[0]) {
        addFinding('warning', 'CLIENT_DRIFT',
          `${roots[i].path} and ${roots[j].path} reference different package-manager workflows.`,
          [roots[i].path, roots[j].path]);
      }
    }
  }
}

export function validateSkills(skillFiles, addFinding) {
  for (const file of skillFiles) {
    const parsed = parseFrontmatter(file.text);
    if (parsed.error === 'missing') {
      addFinding('error', 'SKILL_FRONTMATTER_MISSING', `${file.path} is missing YAML frontmatter.`, [file.path]);
      continue;
    }
    if (parsed.error === 'unclosed') {
      addFinding('error', 'SKILL_FRONTMATTER_UNCLOSED', `${file.path} has unclosed YAML frontmatter.`, [file.path]);
      continue;
    }
    if (!parsed.data.name) addFinding('error', 'SKILL_NAME_MISSING', `${file.path} frontmatter is missing name.`, [file.path]);
    if (!parsed.data.description) addFinding('error', 'SKILL_DESCRIPTION_MISSING', `${file.path} frontmatter is missing description.`, [file.path]);
    if (parsed.data.name?.length > 64) addFinding('warning', 'SKILL_NAME_LONG', `${file.path} skill name exceeds 64 characters.`, [file.path]);
    if (parsed.data.description?.length > 1024) addFinding('warning', 'SKILL_DESCRIPTION_LONG', `${file.path} skill description exceeds 1024 characters.`, [file.path]);
    if (!parsed.body) addFinding('warning', 'SKILL_BODY_EMPTY', `${file.path} has no skill instructions after frontmatter.`, [file.path]);
  }
}

export function validateStandaloneMcp(root, mcpFiles, addFinding) {
  for (const file of mcpFiles) {
    const parsed = parseConfig(readText(root, file), file, addFinding, null, false);
    if (!parsed) continue;
    const key = file === '.vscode/mcp.json' ? 'servers' : 'mcpServers';
    if (!(key in parsed)) {
      addFinding('error', 'MCP_SCHEMA_INVALID', `${file} must contain a ${key} object.`, [file]);
      continue;
    }
    validateMcpServerMap(parsed[key], file, addFinding);
  }
}

function validateOpenCodeMcp(config, file, addFinding) {
  if (config.mcp === undefined) return;
  if (!isObject(config.mcp)) {
    addFinding('error', 'OPENCODE_MCP_INVALID', `${file} mcp must be an object map.`, [file], 'opencode');
    return;
  }
  for (const [name, server] of Object.entries(config.mcp)) {
    if (!isObject(server)) {
      addFinding('error', 'OPENCODE_MCP_INVALID', `${file} MCP entry ${name} must be an object.`, [file], 'opencode');
      continue;
    }
    if (server.type === 'local' && !(Array.isArray(server.command) && server.command.every(v => typeof v === 'string'))) {
      addFinding('error', 'OPENCODE_LOCAL_COMMAND_INVALID', `${file} local MCP entry ${name} must use a command string array.`, [file], 'opencode');
    }
    if (server.type === 'remote' && typeof server.url !== 'string') {
      addFinding('error', 'OPENCODE_REMOTE_URL_INVALID', `${file} remote MCP entry ${name} must define a URL string.`, [file], 'opencode');
    }
  }
}

function validateCodexToml(text, file, addFinding) {
  const sectionPattern = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/gm;
  const matches = [...text.matchAll(sectionPattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    if (!/^\s*(command|url)\s*=/m.test(body)) {
      addFinding(
        'warning',
        'CODEX_MCP_TRANSPORT_MISSING',
        `${file} MCP server ${matches[index][1]} has no command or url key.`,
        [file],
        'codex'
      );
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_.-]*(?:token|secret|password|api[_-]?key)[A-Za-z0-9_.-]*)\s*=\s*["']([^"']+)["']/i);
    if (match && match[2].length >= 8 && !looksLikePlaceholder(match[2])) {
      addFinding('error', 'POSSIBLE_INLINE_SECRET', `${file} appears to contain a literal credential in ${match[1]}.`, [file], 'codex');
    }
  }
}

function validateClaudeSettings(config, file, addFinding) {
  if (config.permissions !== undefined) {
    if (!isObject(config.permissions)) {
      addFinding('error', 'CLAUDE_PERMISSIONS_INVALID', `${file} permissions must be an object.`, [file], 'claude');
    } else {
      for (const key of ['allow', 'deny', 'ask']) {
        const value = config.permissions[key];
        if (value !== undefined && !(Array.isArray(value) && value.every(item => typeof item === 'string'))) {
          addFinding('error', 'CLAUDE_PERMISSION_LIST_INVALID', `${file} permissions.${key} must be an array of strings.`, [file], 'claude');
        }
      }
    }
  }
  if (config.env !== undefined && !isObject(config.env)) {
    addFinding('error', 'CLAUDE_ENV_INVALID', `${file} env must be an object.`, [file], 'claude');
  }
}

export function validateClientConfigs(root, configFiles, addFinding) {
  for (const file of configFiles) {
    const text = readText(root, file);
    if (file === '.codex/config.toml') {
      validateCodexToml(text, file, addFinding);
      continue;
    }
    const jsonc = file.endsWith('.jsonc');
    const client = file.startsWith('.claude/')
      ? 'claude'
      : file.startsWith('.gemini/')
        ? 'gemini'
        : 'opencode';
    const parsed = parseConfig(text, file, addFinding, client, jsonc);
    if (!parsed) continue;
    if (client === 'claude') validateClaudeSettings(parsed, file, addFinding);
    if (client === 'gemini' && parsed.mcpServers !== undefined) {
      validateMcpServerMap(parsed.mcpServers, file, addFinding, client);
    }
    if (client === 'opencode') validateOpenCodeMcp(parsed, file, addFinding);
  }
}


const AGENT_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const AGENT_PLUGIN_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const AGENT_PLUGIN_NAME = /^(?=.{1,64}$)[a-z0-9](?!.*(?:--|\\.\\.))[a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/;

export function validateAgentPlugin(root, pluginFiles, fileSet, addFinding) {
  for (const file of pluginFiles) {
    const parsed = parseConfig(readText(root, file), file, addFinding, 'agent-plugin', false);
    if (!parsed || parsed.$schema !== AGENT_PLUGIN_SCHEMA) continue;
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const rel = name => dir ? `${dir}/${name}` : name;
    if (typeof parsed.name !== 'string' || !AGENT_PLUGIN_NAME.test(parsed.name)) {
      addFinding('error', 'AGENT_PLUGIN_NAME_INVALID', `${file} Agent Plugins 1.0 name must be 1-64 lowercase ASCII letters, digits, dots or hyphens, start/end alphanumeric, and contain no -- or ...`, [file], 'agent-plugin');
    }
    for (const key of ['skills', 'mcpServers', 'agents', 'hooks', 'commands', 'rules', 'lsp']) {
      if (key in parsed) addFinding('warning', 'AGENT_PLUGIN_NONPORTABLE_MANIFEST_FIELD', `${file} uses ${key}; Agent Plugins 1.0 discovers portable skills from skills/ and MCP from root mcp.json. Client-specific components belong under extensions/namespaced directories.`, [file], 'agent-plugin');
    }
    const mcp = rel('mcp.json');
    if (fileSet.has(mcp)) {
      const mcpConfig = parseConfig(readText(root, mcp), mcp, addFinding, 'agent-plugin', false);
      if (mcpConfig && mcpConfig.$schema !== AGENT_PLUGIN_MCP_SCHEMA) {
        addFinding('error', 'AGENT_PLUGIN_MCP_SCHEMA_INVALID', `${mcp} must declare the Agent Plugins 1.0 MCP schema.`, [mcp], 'agent-plugin');
      }
    }
    const skillPrefix = rel('skills/')
    const nestedSkillFiles = [...fileSet].filter(path => path.startsWith(skillPrefix) && path.endsWith('/SKILL.md'));
    for (const skill of nestedSkillFiles) {
      const rest = skill.slice(skillPrefix.length);
      if (rest.split('/').length !== 2) addFinding('warning', 'AGENT_PLUGIN_SKILL_NOT_IMMEDIATE', `${skill} is not in an immediate skills/<name>/SKILL.md directory and may not be discovered portably.`, [skill], 'agent-plugin');
    }
  }
}
