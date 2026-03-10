/**
 * Example 01: Explicit pass-through.
 *
 * Start here if you want the smallest possible contextCompression(...) call.
 * The messages already fit, so the output is unchanged.
 */
import { resetIds, makeConversationTurns, printMessages, runContextCompression } from "./helpers.js";

async function main() {
  console.log("=== Example 01: Basic pass-through ===\n");

  resetIds();
  const messages = makeConversationTurns([
    {
      user: "Summarize the outage timeline from this morning.",
      assistant: "The API started returning 502s right after deploy 143 at 09:12 UTC.",
    },
    {
      user: "What changed in deploy 143?",
      assistant: "It moved session writes to a new Redis client and tightened request timeouts.",
    },
  ], "You are an operations assistant.");

  printMessages("input", messages);
  const result = await runContextCompression({
    messages,
    maxTokens: 8_000,
    compressionThreshold: 0.8,
    onDebug(info) {
      console.log(
        `[debug] messages ${info.originalMessageCount} -> ${info.compressedMessageCount}, ` +
        `tokens ${info.originalTokenEstimate} -> ${info.compressedTokenEstimate}, cacheHit=${info.cacheHit}`
      );
    },
  });
  printMessages("output", result.messages);

  console.log(`\nunchanged: ${JSON.stringify(result.messages) === JSON.stringify(messages)}`);
}

main().catch(console.error);
