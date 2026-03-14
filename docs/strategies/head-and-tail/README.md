# HeadAndTailStrategy

Keeps the beginning and end of a conversation while dropping the middle.

## What Changes In The Prompt

- the opening setup remains
- the recent tail remains
- stale middle turns are removed

## What The Agent Gets

- initial goals and constraints stay visible
- recent blockers stay visible
- less wasted context on middle turns that no longer matter

## Runnable Example

- [`examples/05-head-and-tail.ts`](../../../examples/05-head-and-tail.ts)
