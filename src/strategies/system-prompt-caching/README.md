# SystemPromptCachingStrategy

Reorders system messages into a stable prefix and can consolidate plain system instructions into one message.

## What Changes In The Prompt

- system messages move to the front
- plain system messages can be merged into one block
- tagged context-management system messages stay separate

## What The Agent Gets

- a more stable instruction prefix
- better prompt-cache reuse once the host applies a provider-specific breakpoint on the stable prefix
- less churn in the prompt before dynamic conversation turns

## Host Integration Note

This strategy does not apply provider cache hints by itself.

Hosts that want provider-level prompt caching should:

- run `SystemPromptCachingStrategy` during prompt preparation
- finish any later prompt rewriting
- compare the final prepared prompt to the previous prepared prompt
- place a provider-specific cache breakpoint on the last message in the shared stable prefix

## Runnable Example

- [`examples/06-system-prompt-caching.ts`](../../../examples/06-system-prompt-caching.ts)
