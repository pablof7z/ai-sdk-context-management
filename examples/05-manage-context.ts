/**
 * Example 05: Inspecting the contextCompression result.
 *
 * Shows the rewritten messages plus the stats and segment metadata returned to the host.
 */
import { defaultToolPolicy } from "ai-sdk-context-management";
import {
  makeConversationTurns,
  printMessages,
  printSegments,
  resetIds,
  runContextCompression,
} from "./helpers.js";

async function main() {
  console.log("=== Example 05: Inspecting result ===\n");

  resetIds();
  const result = await runContextCompression({
    messages: makeConversationTurns([
      { user: "What should the package own?", assistant: "Pure prompt rewriting and segment application." },
      { user: "What stays in the app?", assistant: "Lifecycle, persistence, routing, and event production." },
      { user: "What matters most?", assistant: "Stable message ids and explicit invocation." },
      { user: "What should the final API be called?", assistant: "contextCompression(...)." },
    ], "You are helping refactor a context compression package."),
    maxTokens: 120,
    compressionThreshold: 0.6,
    protectedTailCount: 2,
    toolPolicy: defaultToolPolicy,
    segmentGenerator: {
      async generate({ messages }) {
        return [{
          fromId: messages[0].id,
          toId: messages[messages.length - 1].id,
          compressed: "The package owns prompt rewriting and segments; the host owns lifecycle and storage.",
        }];
      },
    },
  });

  printMessages("rewritten messages", result.messages);
  printSegments("new segments", result.newSegments);
  console.log("\nstats:", result.stats);
}

main().catch(console.error);
