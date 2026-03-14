# SystemPromptCachingStrategy

Reorders system messages into a stable prefix and can consolidate plain system instructions into one message.

## What Changes In The Prompt

- system messages move to the front
- plain system messages can be merged into one block
- tagged context-management system messages stay separate

## What The Agent Gets

- a more stable instruction prefix
- better prompt-cache reuse
- less churn in the prompt before dynamic conversation turns

## Runnable Example

- [`examples/06-system-prompt-caching.ts`](../../../examples/06-system-prompt-caching.ts)
