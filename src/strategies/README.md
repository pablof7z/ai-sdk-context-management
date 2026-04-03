# Strategies

Each strategy lives in its own directory with the implementation in `index.ts`, colocated documentation in `README.md`, and strategy-specific tools in `tools/` when the strategy exposes optional tools.

Available strategies:

- [RemindersStrategy](./reminders/README.md)
- [AnthropicPromptCachingStrategy](./anthropic-prompt-caching/README.md)
- [SlidingWindowStrategy](./sliding-window/README.md)
- [ToolResultDecayStrategy](./tool-result-decay/README.md)
- [SummarizationStrategy](./summarization/README.md)
- [ScratchpadStrategy](./scratchpad/README.md)
- [PinnedMessagesStrategy](./pinned-messages/README.md)
- [CompactionToolStrategy](./compaction-tool/README.md)
