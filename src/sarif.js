import { VERSION } from './profiles.js';

const LEVELS = { error: 'error', warning: 'warning', info: 'note' };

export function toSarif(report) {
  const ruleMap = new Map();
  for (const finding of report.findings) {
    if (!ruleMap.has(finding.code)) {
      ruleMap.set(finding.code, {
        id: finding.code,
        name: finding.code.toLowerCase().replace(/_/g, '-'),
        shortDescription: {
          text: finding.code.replace(/_/g, ' ').toLowerCase()
        }
      });
    }
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Agent Compat Lab',
          informationUri: 'https://github.com/yashkhou/agent-compat-lab',
          version: VERSION,
          rules: [...ruleMap.values()]
        }
      },
      results: report.findings.map(finding => ({
        ruleId: finding.code,
        level: LEVELS[finding.severity] || 'note',
        message: { text: finding.message },
        ...(finding.files?.length ? {
          locations: finding.files.map(file => ({
            physicalLocation: {
              artifactLocation: { uri: file },
              region: { startLine: 1, startColumn: 1 }
            }
          }))
        } : {}),
        properties: {
          severity: finding.severity,
          ...(finding.client ? { client: finding.client } : {})
        }
      }))
    }]
  };
}
