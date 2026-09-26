# Agent Compat Lab

Agent Compat Lab is a local-first compatibility test harness for repositories used by multiple AI coding agents.

It inspects the repository-facing contract across Codex, Claude Code, Gemini CLI and OpenCode: instruction files, nested scope, skills, MCP configuration and client-specific project config. The default checks are deterministic and require no model or cloud service.

## What v0.2 checks

- root and nested `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and Codex `AGENTS.override.md`
- structural instruction precedence and narrower-scope workflow drift
- oversized or destructive always-on agent instructions
- `SKILL.md` frontmatter requirements and empty skill bodies
- standalone `.mcp.json`, `mcp.json` and `.vscode/mcp.json` server shape
- Gemini `mcpServers`, OpenCode `mcp`, and Codex MCP sections
- malformed JSON/JSONC and likely inline credentials
- client coverage plus a portable 0–100 compatibility score
- text, JSON and SARIF 2.1.0 output

## Client surfaces

| Client | Instructions | Project config |
| --- | --- | --- |
| Codex | `AGENTS.md`, `AGENTS.override.md` | `.codex/config.toml` |
| Claude Code | `CLAUDE.md`, skills | `.claude/settings.json` |
| Gemini CLI | `GEMINI.md` | `.gemini/settings.json` |
| OpenCode | `AGENTS.md` | `opencode.json[c]`, `.opencode/opencode.json[c]` |

## Portable capability manifest

Export what a repository exposes to coding agents as a machine-readable conformance artifact:

```bash
npx agent-compat-lab . --manifest agent-capabilities.json
```

The manifest reports detected clients, instruction scopes, skills, MCP/config surfaces, precedence, compatibility score, and pass/warn/fail conformance. Agent runtimes and CI can consume it without re-discovering repository conventions from scratch.

## Usage

No runtime dependencies are required.

```bash
node src/cli.js .
node src/cli.js . --json
node src/cli.js . --format sarif
node src/cli.js . --sarif agent-compat.sarif
```

When installed as a package, use the `agent-compat` binary with the same arguments.

By default the CLI exits non-zero only for error findings. Use `--fail-on warning` when warnings should also block CI.

## Precedence model

The harness models repository instruction scope from broad to narrow using file paths. Nested instruction files override broader ancestors for their subtree. For Codex, `AGENTS.override.md` is additionally represented as overriding same-scope `AGENTS.md`.

The model intentionally detects structural precedence and specific deterministic drift such as conflicting package-manager guidance. It does not claim to solve general semantic contradiction detection.

## SARIF and CI

`--format sarif` writes SARIF 2.1.0 to stdout. `--sarif <file>` writes it to disk for CI artifacts or downstream code-scanning workflows.

The included GitHub Actions workflow runs the unit suite, self-scan and SARIF validation on Node 22, then uploads the SARIF file as a build artifact.

## Live corpus

Run the optional live corpus when validating a release:

```bash
node scripts/corpus.js
# or: npm run corpus
```

It shallow-clones a sparse set of current public files from `openai/codex`, `google-gemini/gemini-cli`, `anomalyco/opencode` and `anthropics/claude-code` into temporary storage, scans them, verifies expected markers, then removes the clones.

The live corpus is deliberately not part of required CI because upstream repository changes and network availability should not make this project's deterministic unit tests flaky.

## Design boundaries

Agent Compat Lab reports evidence; it does not execute agent instructions, MCP servers or skill code. Credential detection is heuristic and values are never printed. JSONC parsing supports comments and trailing commas without adding a runtime parser dependency.

Client formats evolve. The profile layer is intentionally small so new paths and schema rules can be updated independently as upstream conventions change.

## Development

```bash
npm test
npm run check
npm run sarif
```

Node.js 20+ is required. The project is MIT licensed.

## GitHub Action

Run Agent Compat Lab directly in a workflow after `actions/checkout`:

```yaml
- uses: yashkhou/agent-compat-lab@main
  with:
    format: sarif
    output: agent-compat.sarif
    fail-on: error
```

The composite action scans `$GITHUB_WORKSPACE` and supports the same `text`, `json`, `sarif`, and `manifest` outputs as the CLI.
