# ScratchpadStrategy

Lets an agent maintain current working state for future turns and selectively remove stale tool exchanges.

## What Changes In The Prompt

- omitted tool exchanges are removed
- a reminder block is appended to the latest user message
- the reminder can include this agent's notes and other agents' notes

## What The Agent Gets

- a place to preserve intermediate findings as structured key/value entries and freeform notes
- note-edit operations for replacing, appending, or clearing notes
- control over which old tool outputs should disappear
- lightweight coordination across agents in the same conversation

## Scratchpad Tool Surface

The optional `scratchpad(...)` tool accepts:

- `setEntries`: merge key/value entries into the scratchpad
- `replaceEntries`: replace the entire key/value map
- `removeEntryKeys`: delete specific keys
- `notes`: replace freeform notes
- `appendNotes`: append to freeform notes
- `clearNotes`: clear freeform notes before applying updates
- `keepLastMessages`: trim older non-system messages while preserving the original task
- `omitToolCallIds`: remove completed tool exchanges after their important parts are captured

Entry names are intentionally open-ended. Agents can use any keys that fit the task, instead of being forced into a fixed schema.

## Recommended Usage Pattern

- Keep the scratchpad as current state, not a chronological log
- Use key/value entries for stable buckets such as objective, thesis, findings, side-effects, or next-steps
- Use freeform notes when the information does not fit cleanly into entries
- Once an insight is captured, omit stale tool exchanges from active context

## Runnable Example

- [`examples/08-scratchpad.ts`](../../../examples/08-scratchpad.ts)
