/**
 * Example 04: Full contextCompression pipeline.
 *
 * Shows caching, persisted segments, retrieval placeholders, and a custom tool policy together.
 */
import { createCompressionCache, defaultToolPolicy } from "ai-sdk-context-management";
import type { CompressionSegment, ContextCompressionResult } from "ai-sdk-context-management";
import {
  makeConversationTurns,
  makeLargeText,
  makeToolExchange,
  printMessages,
  printSegments,
  resetIds,
  runContextCompression,
} from "./helpers.js";

async function main() {
  console.log("=== Example 04: Full pipeline ===\n");

  resetIds();
  const conversationKey = "pipeline-demo";
  const cache = createCompressionCache<ContextCompressionResult>({ maxEntries: 20 });
  const segmentStore = new Map<string, CompressionSegment[]>();

  const messages = [
    ...makeConversationTurns([
      {
        user: "Summarize the incident review so far.",
        assistant: "Deploy 143 caused 502s, rollback restored stability, and stale reads still need regression coverage.",
      },
      {
        user: "What evidence did we collect?",
        assistant: "The outage timeline, Redis client diff, and a stale-read reproduction from the logs.",
      },
    ], "You are an incident review assistant."),
    ...makeToolExchange({
      toolName: "fs_read",
      input: { path: "src/session-store.ts" },
      output: makeLargeText("Source line", 24),
    }),
    ...makeConversationTurns([
      {
        user: "Keep the conclusion concise.",
        assistant: "I will keep the latest recommendation intact.",
      },
    ]),
  ];

  const config = {
    messages,
    maxTokens: 120,
    compressionThreshold: 0.7,
    protectedTailCount: 2,
    conversationKey,
    cache,
    retrievalToolName: "read_tool_output",
    segmentStore: {
      load: (key: string) => segmentStore.get(key) ?? [],
      append: (key: string, segments: CompressionSegment[]) => {
        segmentStore.set(key, [...(segmentStore.get(key) ?? []), ...segments]);
      },
    },
    toolPolicy(context: Parameters<typeof defaultToolPolicy>[0]) {
      const base = defaultToolPolicy(context);

      if (context.toolName === "fs_read") {
        return {
          ...base,
          result: { policy: "remove" as const },
        };
      }

      return base;
    },
    segmentGenerator: {
      async generate({ messages: candidateMessages }: { messages: Array<{ id: string }> }) {
        return [{
          fromId: candidateMessages[0].id,
          toId: candidateMessages[candidateMessages.length - 1].id,
          compressed: "Deploy 143 introduced stale reads, rollback restored service, and follow-up work now targets regression coverage.",
        }];
      },
    },
  };

  console.log("-- first call: generates new segments --");
  const firstResult = await runContextCompression(config);
  printMessages("first output", firstResult.messages);
  printSegments("stored segments", segmentStore.get(conversationKey) ?? []);

  console.log("\n-- second call: reuses stored segments --");
  const secondResult = await runContextCompression({ ...config, cache: undefined });
  printMessages("second output", secondResult.messages);

  console.log("\n-- third call: cache serves the same rewritten messages --");
  const thirdResult = await runContextCompression(config);
  printMessages("third output", thirdResult.messages);
}

main().catch(console.error);
