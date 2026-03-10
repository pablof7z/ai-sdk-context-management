# Examples

Runnable examples for `ai-sdk-context-management`.

The package README is the overview. This file is the practical guide.

## Setup

```bash
cd examples
npm install
```

These examples use mock segment generation, so they run without API keys.

## Suggested Reading Order

1. `01-basic-passthrough.ts`
2. `02-tool-output-policies.ts`
3. `03-persisted-segments.ts`
4. `04-full-pipeline.ts`
5. `05-manage-context.ts`

Then use `06` and `07` as lower-level utility references.

## Example Guide

### 01-basic-passthrough.ts
- Shows the smallest possible `contextCompression(...)` call.
- Demonstrates the unchanged pass-through case.

### 02-tool-output-policies.ts
- Shows always-on `toolPolicy(context)` behavior.
- Demonstrates retrieval placeholders via `retrievalToolName`.

### 03-persisted-segments.ts
- Shows `segmentStore.load(...)` and `segmentStore.save(...)`.
- Demonstrates explicit `conversationKey` usage.

### 04-full-pipeline.ts
- Shows cache + persistence + retrieval placeholders together.
- Demonstrates a production-style `contextCompression(...)` setup.

### 05-manage-context.ts
- Shows how to inspect the returned `messages`, `newSegments`, and `stats`.
- Useful when the host wants detailed compression telemetry.

### 06-segment-generator-prompt.ts
- Shows the default segment prompt template and prompt customization.
- Demonstrates `createSegmentGenerator(...)`.

### 07-transcript-and-utilities.ts
- Shows transcript rendering and manual segment validation/application.
- Works directly with `ContextMessage[]`.

## API Coverage Map

| API | Where to look |
| --- | --- |
| `contextCompression(...)` | `01`, `02`, `03`, `04`, `05` |
| `toolPolicy(context)` | `02`, `04` |
| `defaultToolPolicy(context)` | `02`, `04`, `05` |
| `segmentStore` | `03`, `04` |
| `conversationKey` | `03`, `04` |
| `createCompressionCache(...)` | `04` |
| `createSegmentGenerator(...)` | `04`, `06` |
| `DEFAULT_SEGMENT_PROMPT_TEMPLATE` | `06` |
| `buildDefaultSegmentPrompt(...)` | `06` |
| `createTranscript(...)` | `06`, `07` |
| `validateSegments(...)` | `07` |
| `applySegments(...)` | `07` |
| `buildSummaryMessage(...)` | `07` |

## Run Everything

```bash
npx tsx 01-basic-passthrough.ts
npx tsx 02-tool-output-policies.ts
npx tsx 03-persisted-segments.ts
npx tsx 04-full-pipeline.ts
npx tsx 05-manage-context.ts
npx tsx 06-segment-generator-prompt.ts
npx tsx 07-transcript-and-utilities.ts
```
