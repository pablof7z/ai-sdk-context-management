# SlidingWindowStrategy

Keeps only the most recent non-system messages and drops older turns.

## What Changes In The Prompt

- older non-system messages are removed
- system messages stay
- tool call and tool result pairs are preserved at the trim boundary

## What The Agent Gets

- predictable bounded context
- lower latency and cost
- a bias toward the most recent conversation state

## Runnable Example

- [`examples/01-sliding-window.ts`](../../../examples/01-sliding-window.ts)
