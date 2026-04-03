# RemindersStrategy

`RemindersStrategy` owns reminder production and delivery.

It can:

- render host-provided reminder providers with full/delta/skip behavior
- persist reminder state through `ReminderStateStore`
- place reminders into `overlay-user`, `latest-user-append`, or `fallback-system`
- include built-in context-utilization and context-window-status reminder sources
- queue and defer one-shot reminders through the runtime reminder path

`contextWindowStatus` is raw-model-window reporting only. It uses the provider-reported input-token count passed to `prepared.reportActualUsage(...)` on the previous completed step plus `getContextWindow(...)` to emit a reminder such as `Provider-reported last request window: 60% (120,000/200,000 tokens).`

Use this strategy when reminder content should be part of prompt preparation rather than hand-managed by the host.
