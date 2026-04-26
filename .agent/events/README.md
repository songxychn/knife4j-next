# Agent Events

This directory stores append-only NDJSON event logs.

File name convention: `YYYY-MM-DD.ndjson`.

Example line:

```json
{"ts":"2026-04-26T12:00:00+08:00","event":"task.updated","task_id":"TASK-026","agent":"codex","fields":["status"],"summary":"Moved task to in_progress after acquiring lease."}
```

Events explain how state changed. They are not the source of current task status; `.agent/tasks/*.yaml` is.
