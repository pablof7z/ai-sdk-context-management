/**
 * Test single-tool pressure anchors
 * Large individual results decay immediately, small ones persist longer
 */
import type { ModelMessage } from "ai";
import {
  ToolResultDecayStrategy,
  createContextManagementRuntime,
} from "../src/index.js";
import { printPrompt, runPreparedDemo } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new ToolResultDecayStrategy({
        maxResultTokens: 200,
        placeholderMinSourceTokens: 800,
        minPlaceholderBatchSize: 1, // Lower to see single-tool effect
        // Global pressure: based on total tool token usage
        pressureAnchors: [
          { toolTokens: 100, depthFactor: 0.05 },
          { toolTokens: 5_000, depthFactor: 1 },
        ],
        // Single-tool pressure: based on individual result size
        singleToolPressureAnchors: [
          { toolTokens: 500, depthFactor: 0.01 },     // Small - keep very long
          { toolTokens: 5_000, depthFactor: 1 },      // Medium - normal decay
          { toolTokens: 50_000, depthFactor: 10 },    // Large - decay immediately
        ],
      }),
    ],
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Read these files and summarize." },
  ];

  // Simulate reading a small text file (2k tokens)
  messages.push({
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call_small_file",
        toolName: "fs_read",
        input: { path: "small.txt" },
      },
    ],
  });
  messages.push({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_small_file",
        toolName: "fs_read",
        output: {
          type: "text",
          value: "This is a small file. ".repeat(100), // ~2.4k chars ≈ 600 tokens
        },
      },
    ],
  });

  // Simulate reading a huge image file (100k tokens)
  messages.push({
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call_large_image",
        toolName: "fs_read",
        input: { path: "image.jpg" },
      },
    ],
  });
  messages.push({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_large_image",
        toolName: "fs_read",
        output: {
          type: "text",
          value: "BASE64_IMAGE_DATA_".repeat(10000), // ~170k chars ≈ 42k tokens
        },
      },
    ],
  });

  // Add one more turn to trigger decay (depth >= 1)
  messages.push({ role: "user", content: "What did you see?" });

  const { capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "I saw a small file and a large image.",
  });

  printPrompt("After single-tool pressure decay", capturedPrompts[0]);

  console.log("\n✅ Expected behavior:");
  console.log("- Small file (600 tokens): KEPT (singleToolDepthFactor = 0.01, very gentle)");
  console.log("- Large image (42k tokens): DECAYED (singleToolDepthFactor = 10, aggressive)");
  console.log("\nThis prevents huge one-off results (JPGs, PDFs) from staying in context,");
  console.log("while preserving smaller frequently-referenced files.");
}

main().catch(console.error);
