# SummarizationStrategy

Replaces older messages with a summary once the prompt crosses a token budget.

## What Changes In The Prompt

- older turns are summarized into a tagged system message
- the most recent tail remains verbatim
- repeated summarization can build on a previous summary block

## What The Agent Gets

- access to older facts in compressed form
- more room for current work
- a host-controlled summarization path

## Runnable Example

- [`examples/03-summarization.ts`](../../../examples/03-summarization.ts)
