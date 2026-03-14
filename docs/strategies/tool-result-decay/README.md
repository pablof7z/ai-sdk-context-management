# ToolResultDecayStrategy

Compresses tool outputs by age while preserving the surrounding tool-call structure.

## What Changes In The Prompt

- newest tool results stay verbatim
- medium-age results are truncated
- oldest results become placeholders

## What The Agent Gets

- recent observations stay detailed
- old reasoning chains remain understandable
- prompt size drops without erasing the fact that tools were used

## Runnable Example

- [`examples/02-tool-result-decay.ts`](../../../examples/02-tool-result-decay.ts)
