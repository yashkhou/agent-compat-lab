import { CLIENT_PROFILES, VERSION } from './profiles.js';

export function buildCapabilityManifest(report) {
  const clients = Object.entries(report.detected).filter(([, enabled]) => enabled).map(([name]) => name);
  return {
    schema: 'https://agentcompat.dev/schema/capabilities-v1.json',
    schemaVersion: '1.0',
    generator: { name: 'agent-compat-lab', version: VERSION },
    compatibility: { score: report.score, clients, clientSupport: report.detected },
    capabilities: {
      instructions: report.inventory.instructionFiles,
      skills: report.inventory.skillFiles,
      mcp: report.inventory.mcpFiles,
      clientConfigs: report.inventory.configFiles,
      precedenceModel: Object.fromEntries(Object.entries(report.precedence).filter(([key]) => clients.includes(key)))
    },
    conformance: {
      status: report.findings.some(f => f.severity === 'error') ? 'fail' : report.findings.some(f => f.severity === 'warning') ? 'warn' : 'pass',
      errors: report.findings.filter(f => f.severity === 'error').map(f => f.code),
      warnings: report.findings.filter(f => f.severity === 'warning').map(f => f.code)
    },
    knownClients: Object.keys(CLIENT_PROFILES)
  };
}
