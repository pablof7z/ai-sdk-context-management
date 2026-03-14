# ContextUtilizationReminderStrategy

Warns the agent when the prompt is approaching a configured working budget.

## What Changes In The Prompt

- a reminder block is appended once utilization crosses a threshold
- no history is removed directly by this strategy

## What The Agent Gets

- an explicit signal that it should summarize, compact, or trim stale context
- better self-management before the prompt becomes unusable

## Runnable Example

- [`examples/11-context-utilization-reminder.ts`](../../../examples/11-context-utilization-reminder.ts)
