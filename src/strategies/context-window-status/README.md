# ContextWindowStatusStrategy

Adds a compact context-capacity status block to the latest user message.

## What Changes In The Prompt

- appends a context-status reminder to the latest user message
- can show both a scoped `budgetProfile` and the model's raw context window
- includes a request-token breakdown when tool definitions contribute meaningful size

## What The Agent Gets

- explicit visibility into current request size after context management
- a budget-profile utilization percentage for operational decisions
- optional raw-window utilization when the caller can provide model context limits

## Runnable Example

- No dedicated runnable example yet.
