/**
 * Example 01: Basic pass-through through the AI SDK adapter.
 */
import { createContextManagementMiddleware } from "ai-sdk-context-mgmt-middleware";
import { generateConversation, printPrompt, runMiddlewareTransform } from "./helpers.js";

async function main() {
  console.log("=== Example 01: Basic pass-through ===\n");

  const middleware = createContextManagementMiddleware({
    maxTokens: 128_000,
    compressionThreshold: 0.8,
    onDebug: (info) => {
      console.log(
        `[debug] messages ${info.originalMessageCount} -> ${info.compressedMessageCount}, ` +
        `tokens ${info.originalTokenEstimate} -> ${info.compressedTokenEstimate}, cacheHit=${info.cacheHit}`
      );
    },
  });

  const prompt = generateConversation(3);
  printPrompt("input", prompt);

  const output = await runMiddlewareTransform(middleware, prompt);
  printPrompt("output", output);

  console.log(`\nunchanged: ${JSON.stringify(output) === JSON.stringify(prompt)}`);
}

main().catch(console.error);
