# LLMSummarizationStrategy

Wraps `SummarizationStrategy` with an AI SDK model-backed summarizer.

## What Changes In The Prompt

- older turns are replaced by an LLM-produced summary
- the recent tail remains raw
- a deterministic fallback summary is used if the LLM path fails

## What The Agent Gets

- better compression quality than a fixed string reducer
- fewer host-side moving parts
- the same summarized-history behavior with less custom code

## Runnable Example

- [`examples/07-llm-summarization.ts`](../../../examples/07-llm-summarization.ts)
