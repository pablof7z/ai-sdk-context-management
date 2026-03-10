/**
 * Example 03: Reusing persisted segments.
 *
 * The first run generates a segment. The second run loads it and skips regeneration.
 */
import type { CompressionSegment } from "ai-sdk-context-management";
import {
  makeConversationTurns,
  printMessages,
  resetIds,
  runContextCompression,
} from "./helpers.js";

async function main() {
  console.log("=== Example 03: Persisted segments ===\n");

  resetIds();
  const conversationKey = "incident-review-42";
  const segmentStore = new Map<string, CompressionSegment[]>();
  let generatorCalls = 0;

  const messages = makeConversationTurns([
    {
      user: "Capture the timeline from the outage review.",
      assistant: "The first customer impact happened at 09:12 UTC after deploy 143.",
    },
    {
      user: "What was the first mitigation?",
      assistant: "We rolled traffic back to the previous Redis client at 09:21 UTC.",
    },
    {
      user: "What still needs follow-up?",
      assistant: "We still need a regression test for stale reads after reconnect.",
    },
    {
      user: "Include the customer-facing impact.",
      assistant: "About 7% of requests returned 502s for nine minutes.",
    },
  ], "You write short incident summaries.");

  console.log("-- first call: no stored segments yet --");
  const firstResult = await runContextCompression({
    messages,
    maxTokens: 180,
    compressionThreshold: 0.6,
    protectedTailCount: 2,
    conversationKey,
    segmentStore: {
      load: (key) => segmentStore.get(key) ?? [],
      save: (key, segments) => {
        segmentStore.set(key, segments);
      },
    },
    segmentGenerator: {
      async generate({ messages }) {
        generatorCalls++;
        return [{
          fromId: messages[0].id,
          toId: messages[messages.length - 1].id,
          compressed: "Timeline: deploy 143 caused 502s, rollback fixed impact, stale-read regression test still pending.",
        }];
      },
    },
  });

  printMessages("first output", firstResult.messages);
  console.log(`stored segments: ${segmentStore.get(conversationKey)?.length ?? 0}`);
  console.log(`generator calls: ${generatorCalls}`);

  console.log("\n-- second call: stored segment is reused --");
  const secondResult = await runContextCompression({
    messages,
    maxTokens: 180,
    compressionThreshold: 0.6,
    protectedTailCount: 2,
    conversationKey,
    segmentStore: {
      load: (key) => segmentStore.get(key) ?? [],
      save: (key, segments) => {
        segmentStore.set(key, segments);
      },
    },
  });

  printMessages("second output", secondResult.messages);
  console.log(`stored segments: ${segmentStore.get(conversationKey)?.length ?? 0}`);
  console.log(`generator calls: ${generatorCalls}`);
}

main().catch(console.error);
