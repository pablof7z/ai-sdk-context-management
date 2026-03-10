/**
 * Example 03: Persisted segments through a SegmentStore.
 *
 * The first call generates a segment and saves it. The second call reuses the
 * stored segment instead of regenerating it.
 */
import { createContextManagementMiddleware } from "ai-sdk-context-mgmt-middleware";
import { generateConversation, printPrompt, runMiddlewareTransform } from "./helpers.js";

async function main() {
  console.log("=== Example 03: Persisted segments ===\n");

  const segmentStore = new Map<string, any[]>();
  let generationCount = 0;

  const middleware = createContextManagementMiddleware({
    maxTokens: 420,
    compressionThreshold: 0.6,
    protectedTailCount: 2,
    segmentStore: {
      load: (conversationKey) => segmentStore.get(conversationKey) ?? [],
      save: (conversationKey, segments) => {
        segmentStore.set(conversationKey, segments);
      },
    },
    resolveConversationKey({ params }) {
      return (params.providerOptions as any).contextManagement.conversationId;
    },
    segmentGenerator: {
      async generate({ messages }) {
        generationCount++;
        return [{
          fromId: messages[0].id,
          toId: messages[messages.length - 1].id,
          compressed: `Summary generated from ${messages.length} messages`,
        }];
      },
    },
    onDebug: (info) => {
      console.log(
        `[debug] newSegments=${info.newSegments.length}, appliedSegments=${info.appliedSegments.length}, ` +
        `tokens ${info.originalTokenEstimate} -> ${info.compressedTokenEstimate}`
      );
    },
  });

  const prompt = generateConversation(6);
  const providerOptions = { contextManagement: { conversationId: "conv-123" } };

  console.log("-- first turn --");
  const firstOutput = await runMiddlewareTransform(middleware, prompt, providerOptions);
  printPrompt("first output", firstOutput);
  console.log(`stored segments: ${segmentStore.get("conv-123")?.length ?? 0}`);
  console.log(`generation count: ${generationCount}`);

  console.log("\n-- second turn with same history --");
  const secondOutput = await runMiddlewareTransform(middleware, prompt, providerOptions);
  printPrompt("second output", secondOutput);
  console.log(`stored segments: ${segmentStore.get("conv-123")?.length ?? 0}`);
  console.log(`generation count: ${generationCount}`);
}

main().catch(console.error);
