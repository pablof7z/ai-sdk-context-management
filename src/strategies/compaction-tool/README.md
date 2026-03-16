# CompactionToolStrategy

Adds a tool that lets the agent decide when to compact old history into a summary.

## What Changes In The Prompt

- after `compact_context`, older turns are replaced by a summary
- an optional store can re-inject that summary on later turns

## What The Agent Gets

- control over when compression happens
- the ability to compact after a task boundary instead of on a blind token threshold
- a persistent compacted state if the host provides storage

## Runnable Example

- [`examples/10-compaction-tool.ts`](../../../examples/10-compaction-tool.ts)
