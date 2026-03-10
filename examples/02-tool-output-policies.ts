/**
 * Example 02: Always-on tool policy.
 *
 * Shows how one toolPolicy(context) can reason about both sides of a tool exchange.
 */
import { defaultToolPolicy } from "ai-sdk-context-management";
import {
  makeConversationTurns,
  makeLargeText,
  makeToolExchange,
  printMessages,
  resetIds,
  runContextCompression,
} from "./helpers.js";

async function main() {
  console.log("=== Example 02: Tool policy ===\n");

  resetIds();
  const messages = [
    ...makeConversationTurns([
      {
        user: "Why did the incident review mention stale cache reads?",
        assistant: "Because writes succeeded but some readers were still using the previous connection pool.",
      },
    ], "You are a debugging assistant."),
    ...makeToolExchange({
      toolName: "fs_write",
      input: {
        path: "src/session-store.ts",
        patch: makeLargeText("Patch hunk", 16),
      },
      output: "Updated src/session-store.ts successfully.",
    }),
    ...makeToolExchange({
      toolName: "fs_read",
      input: { path: "src/session-store.ts" },
      output: makeLargeText("Source line", 18),
    }),
    ...makeToolExchange({
      toolName: "logs_search",
      input: { query: "timeout exceeded", window: "last-6-hours" },
      output: makeLargeText("Log event", 14),
    }),
    ...makeConversationTurns([
      {
        user: "Keep the final recommendation short.",
        assistant: "I will keep the most recent recommendation verbatim.",
      },
    ]),
  ];

  const result = await runContextCompression({
    messages,
    maxTokens: 20_000,
    compressionThreshold: 0.95,
    retrievalToolName: "read_tool_output",
    toolPolicy(context) {
      const base = defaultToolPolicy(context);

      if (context.toolName === "fs_write" && context.call) {
        return {
          ...base,
          call: { policy: "truncate", maxTokens: 40 },
          result: { policy: "keep" },
        };
      }

      if (context.toolName === "fs_read" && context.result) {
        return {
          ...base,
          result: { policy: "truncate", maxTokens: 48 },
        };
      }

      if (context.toolName === "logs_search") {
        return {
          ...base,
          result: { policy: "remove" },
        };
      }

      return base;
    },
    onDebug(info) {
      console.log(
        `[debug] tokens ${info.originalTokenEstimate} -> ${info.compressedTokenEstimate}, ` +
        `modifications=${info.modifications.length}`
      );
    },
  });

  printMessages("input", messages);
  printMessages("output", result.messages);

  console.log("\nmodifications:");
  for (const modification of result.modifications) {
    console.log(`  ${modification.type} at message index ${modification.messageIndex}`);
  }
}

main().catch(console.error);
