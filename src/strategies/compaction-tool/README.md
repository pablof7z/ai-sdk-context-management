# CompactionToolStrategy

Adds a tool that lets the agent decide when to compact old history into a summary.

## What Changes In The Prompt

- after `compact_context({ message, from?, to? })`, older `user`/`assistant` turns are replaced by the supplied continuation summary
- an optional store can re-inject anchored compaction edits on later turns

## What The Agent Gets

- control over when compression happens
- the ability to compact after a task boundary instead of on a blind token threshold
- a persistent compacted state if the host provides storage
- optional automatic compaction via `shouldCompact(...)` and `onCompact(...)`

## Runnable Example

- [`examples/10-compaction-tool.ts`](../../../examples/10-compaction-tool.ts)
