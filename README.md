# Agent Compat Lab

A small, local-first compatibility linter for repositories used by multiple AI coding agents.

Coding-agent setups are becoming a mix of `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, skills, MCP servers and client-specific config. Agent Compat Lab checks the repository-facing surface before those instructions drift or become unsafe.

## What it catches

- conflicting package-manager guidance across agent instruction files
- oversized always-on instruction files that consume context
- destructive command guidance in agent instructions
- invalid MCP JSON and likely inline credentials
- missing or single-client repository configuration
- a portable 0–100 compatibility score plus machine-readable JSON

## Usage

```bash
node src/cli.js /path/to/repo
node src/cli.js /path/to/repo --json
```

Exit code `1` means at least one error-level finding was detected. Warnings do not fail CI.
