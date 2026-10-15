## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root; decisions are D-numbered entries in `docs/decisions.md`. See `docs/agents/domain.md`.

## Building the plugin

Building or changing the plugin: read `docs/agents/platform/IMPLEMENTER-RULES.md` first. `npm run check` is the gate before every commit.
