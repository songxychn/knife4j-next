# RUN-20260426-state-model

task: TASK-ADHOC-20260426-01
branch: current
agent: codex
status: review

## Changed Files

- .agent/STATE.md
- .agent/TASKS.md
- .agent/PROGRESS.md
- .agent/tasks/TEMPLATE.yaml
- .agent/tasks/TASK-023.yaml
- .agent/tasks/TASK-024.yaml
- .agent/tasks/TASK-025.yaml
- .agent/tasks/TASK-026.yaml
- .agent/tasks/TASK-027.yaml
- .agent/tasks/TASK-028.yaml
- .agent/tasks/TASK-029.yaml
- .agent/tasks/TASK-030.yaml
- .agent/tasks/TASK-031.yaml
- .agent/leases/TEMPLATE.json
- .agent/events/README.md
- .agent/events/2026-04-26.ndjson
- .agent/runs/TEMPLATE.md
- .agent/runs/RUN-20260426-state-model.md

## Decisions

- Introduced `.agent/tasks/*.yaml` as the single authoritative task status source.
- Kept `.agent/TASKS.md` and `.agent/PROGRESS.md` as legacy human-readable views to avoid rewriting history.
- Migrated only active `ready`, `blocked`, and `review` tasks to minimize churn.
- Added lease, event, and run handoff templates so future agents can claim work and leave resumable context.

## Validation

- Documentation and state-file change only; no code build required.
- File presence and active task migration reviewed locally.

## Risks

- Existing agents that only read `.agent/TASKS.md` may still ignore the YAML registry until prompts are updated.
- No generator exists yet to sync `.agent/tasks/*.yaml` back into Markdown summaries.

## Next Steps

- Update `AGENTS.md` or `.agent/COORDINATION.md` to require reading `.agent/STATE.md` and `.agent/tasks/*.yaml` before selecting work.
- Optionally add a small validation script that checks task YAML fields and dependency/status consistency.
