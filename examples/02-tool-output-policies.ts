/**
 * Example 02: Always-on tool output policy.
 *
 * Demonstrates that tool-result truncation/removal runs even when the
 * conversation is still below the segment-compression threshold.
 */
import { createContextManagementMiddleware } from "ai-sdk-context-mgmt-middleware";
import { generateConversation, generateToolExchange, getTextContent, printPrompt, runMiddlewareTransform } from "./helpers.js";

async function main() {
  console.log("=== Example 02: Tool output policies ===\n");

  const truncatedOutputs: Array<{ toolName: string; removed: boolean; originalTokens: number }> = [];

  const middleware = createContextManagementMiddleware({
    maxTokens: 20_000,
    compressionThreshold: 0.95,
    toolOutput: {
      defaultPolicy: "truncate",
      maxTokens: 40,
      recentFullCount: 0,
      toolOverrides: {
        debug_logs: "remove",
        important_data: "keep",
      },
    },
    onToolOutputTruncated: async (event) => {
      truncatedOutputs.push({
        toolName: event.toolName,
        removed: event.removed,
        originalTokens: event.originalTokens,
      });

      if (event.removed) {
        return `[Output stored externally for ${event.toolName}:${event.toolCallId}]`;
      }

      return undefined;
    },
    onDebug: (info) => {
      console.log(
        `[debug] tokens ${info.originalTokenEstimate} -> ${info.compressedTokenEstimate}, ` +
        `modifications=${info.modifications.length}`
      );
    },
  });

  const prompt = [
    ...generateConversation(2),
    ...generateToolExchange("search_results", 250),
    ...generateToolExchange("debug_logs", 180),
    ...generateToolExchange("important_data", 120),
    ...generateConversation(1),
  ];

  printPrompt("input", prompt);
  const output = await runMiddlewareTransform(middleware, prompt);
  printPrompt("output", output);

  console.log("\ntruncation events:");
  for (const event of truncatedOutputs) {
    console.log(`  ${event.toolName}: ${event.removed ? "removed" : "truncated"} (${event.originalTokens} tokens)`);
  }

  console.log("\nfinal tool outputs:");
  for (const message of output.filter((message) => message.role === "tool")) {
    console.log(`  ${getTextContent(message).slice(0, 120)}${getTextContent(message).length > 120 ? "..." : ""}`);
  }
}

main().catch(console.error);
