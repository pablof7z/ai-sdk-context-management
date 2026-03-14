# ScratchpadStrategy

Lets an agent write notes for future turns and selectively remove stale tool exchanges.

## What Changes In The Prompt

- omitted tool exchanges are removed
- a reminder block is appended to the latest user message
- the reminder can include this agent's notes and other agents' notes

## What The Agent Gets

- a place to preserve intermediate findings
- control over which old tool outputs should disappear
- lightweight coordination across agents in the same conversation

## Runnable Example

- [`examples/08-scratchpad.ts`](../../../examples/08-scratchpad.ts)
