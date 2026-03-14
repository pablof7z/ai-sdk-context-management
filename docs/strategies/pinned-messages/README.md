# PinnedMessagesStrategy

Lets the agent protect specific tool call IDs from later pruning.

## What Changes In The Prompt

- pinned tool exchanges are marked as protected before other strategies run
- later trimming, decay, or summarization skips those exchanges

## What The Agent Gets

- explicit control over which observations remain available
- protection for critical evidence such as failing logs or key file reads
- safer composition with aggressive pruning strategies

## Runnable Example

- [`examples/09-pinned-messages.ts`](../../../examples/09-pinned-messages.ts)
