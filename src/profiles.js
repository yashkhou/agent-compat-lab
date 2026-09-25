export const VERSION = '0.2.0';

export const CLIENT_PROFILES = {
  codex: {
    label: 'Codex',
    instructionNames: ['AGENTS.md', 'AGENTS.override.md'],
    configPaths: ['.codex/config.toml'],
    markerPrefixes: ['.codex/']
  },
  claude: {
    label: 'Claude Code',
    instructionNames: ['CLAUDE.md'],
    configPaths: ['.claude/settings.json', '.claude/settings.local.json'],
    markerPrefixes: ['.claude/']
  },
  gemini: {
    label: 'Gemini CLI',
    instructionNames: ['GEMINI.md'],
    configPaths: ['.gemini/settings.json'],
    markerPrefixes: ['.gemini/']
  },
  opencode: {
    label: 'OpenCode',
    instructionNames: ['AGENTS.md'],
    configPaths: ['opencode.json', 'opencode.jsonc', '.opencode/opencode.json', '.opencode/opencode.jsonc'],
    markerPrefixes: ['.opencode/']
  }
};

export const INSTRUCTION_NAMES = new Set(
  Object.values(CLIENT_PROFILES).flatMap(profile => profile.instructionNames)
);

export const ROOT_CONFIG_PATHS = new Set(
  Object.values(CLIENT_PROFILES).flatMap(profile => profile.configPaths)
);

export const STANDALONE_MCP_PATHS = new Set(['.mcp.json', 'mcp.json', '.vscode/mcp.json']);

export function clientsForInstructionName(name) {
  return Object.entries(CLIENT_PROFILES)
    .filter(([, profile]) => profile.instructionNames.includes(name))
    .map(([client]) => client);
}
