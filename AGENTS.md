# Agent Compat Lab

Use `npm` for project commands. Run `npm test` and `npm run check` before committing changes.

Keep the runtime dependency-free unless a dependency materially improves standards compliance. Compatibility checks should stay deterministic and local-first: do not require a model call for normal scans.

Client-specific behavior belongs in small profiles or validators rather than one large CLI file. Preserve the JSON report shape where practical and add tests for every new finding code.

The live public-repository corpus is a manual validation surface, not a required CI dependency. CI must remain deterministic when external repositories change or GitHub is unavailable.
