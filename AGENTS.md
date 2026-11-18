## Verification checks

Run `npm run check` before you report a change as complete; `npm run format` fixes formatting failures.

Fix a lint failure in the code. `oxlint-suppressions.json`, `boolean-names-suppressions.json` and `.dependency-cruiser-known-violations.json` only shrink: after fixing an old violation, run `npm run lint:prune` or `npm run lint:boundaries:baseline`.

## Modules

Modules are deep modules: see [app/modules/README.md](./app/modules/README.md) before adding or importing one.

## When something breaks

| Symptom                                         | Cause                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 401 "Select a user from the DevUI panel"        | No user in the session — switch users and country in the floating panel (`app/components/dev-ui.tsx`). |
| `tsc` reports every `./+types/*` import missing | Typegen has not run. Use `npm run typecheck`, which runs `react-router typegen` first.                 |

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on your own copy of this repo (the `origin` remote), never on `ai-hero-dev/cohort-005-project`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.
