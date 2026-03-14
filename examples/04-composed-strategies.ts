/**
 * Composed Strategies — Multiple strategies in a single pipeline
 *
 * Combines SlidingWindow + ToolResultDecay + SystemPromptCaching to show
 * how strategies compose. Each one transforms the prompt in sequence:
 *   1. SlidingWindow drops the oldest messages
 *   2. ToolResultDecay compresses old tool results in what remains
 *   3. SystemPromptCaching consolidates system messages for cache efficiency
 *
 * Requires: ollama running locally with qwen2.5:3b pulled
 */
import { generateText, wrapLanguageModel, type ModelMessage } from "ai";
import type { LanguageModelV3Middleware, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { ollama } from "ollama-ai-provider-v2";
import {
  createContextManagementRuntime,
  SlidingWindowStrategy,
  SystemPromptCachingStrategy,
  ToolResultDecayStrategy,
} from "ai-sdk-context-management";
import { printPrompt } from "./helpers.js";

const CONTEXT_OPTIONS = {
  contextManagement: { conversationId: "demo", agentId: "demo" },
};

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new SlidingWindowStrategy({ keepLastMessages: 8 }),
      new ToolResultDecayStrategy({
        keepFullResultCount: 1,
        truncateWindowCount: 1,
        truncatedMaxTokens: 25,
        placeholder: "[omitted]",
      }),
      new SystemPromptCachingStrategy({ consolidateSystemMessages: true }),
    ],
  });

  // Capture transformed prompt
  const capturedPrompts: LanguageModelV3Prompt[] = [];
  const logging: LanguageModelV3Middleware = {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      capturedPrompts.push([...params.prompt]);
      return params;
    },
  };

  const base = ollama("qwen2.5:3b");
  const logged = wrapLanguageModel({ model: base, middleware: logging });
  const model = wrapLanguageModel({ model: logged, middleware: runtime.middleware });

  // Build a multi-turn agent conversation with tool calls and regular messages
  const messages: ModelMessage[] = [
    { role: "system", content: "You are a coding assistant with file reading capabilities." },
    // Turn 1: user asks, agent reads a file
    { role: "user", content: "What does the main config file look like?" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "t1", toolName: "read_file", input: { path: "config.json" } }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result", toolCallId: "t1", toolName: "read_file",
        output: { type: "text", value: '{ "port": 3000, "host": "localhost", "debug": true, "database": { "url": "postgres://localhost:5432/app", "pool": 10 } }' },
      }],
    },
    { role: "assistant", content: "The config sets port 3000, localhost, debug mode, and a postgres database." },
    // Turn 2: another file read
    { role: "user", content: "Show me the test setup." },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "t2", toolName: "read_file", input: { path: "test/setup.ts" } }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result", toolCallId: "t2", toolName: "read_file",
        output: { type: "text", value: 'import { beforeAll, afterAll } from "vitest";\nimport { createTestDatabase } from "./helpers";\n\nbeforeAll(async () => {\n  await createTestDatabase();\n});\n\nafterAll(async () => {\n  await cleanupTestDatabase();\n});' },
      }],
    },
    { role: "assistant", content: "The test setup creates and tears down a test database using vitest hooks." },
    // Turn 3: yet another file
    { role: "user", content: "And the main entry point?" },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "t3", toolName: "read_file", input: { path: "src/index.ts" } }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result", toolCallId: "t3", toolName: "read_file",
        output: { type: "text", value: 'import { createServer } from "./server";\nimport { loadConfig } from "./config";\n\nconst config = loadConfig();\nconst server = createServer(config);\nserver.listen(config.port, () => console.log(`Running on ${config.port}`));' },
      }],
    },
    { role: "assistant", content: "The entry point loads config and starts the server." },
    // Turn 4: question about what was read
    { role: "user", content: "Based on everything you've read, how is the project structured?" },
  ];

  console.log(`=== Full conversation: ${messages.length} messages (3 tool exchanges) ===`);
  console.log("Pipeline: SlidingWindow(8) -> ToolResultDecay(full=1, trunc=1) -> SystemPromptCaching\n");

  const result = await generateText({
    model,
    messages,
    providerOptions: CONTEXT_OPTIONS,
  });

  printPrompt("What the model received after all 3 strategies", capturedPrompts[0]);

  console.log("\n=== Strategy effects ===");
  console.log("1. SlidingWindow(8): kept last 8 non-system messages (some early turns may be dropped)");
  console.log("2. ToolResultDecay: t1 -> [omitted], t2 -> truncated, t3 -> full");
  console.log("3. SystemPromptCaching: system messages consolidated into one for cache efficiency");

  console.log(`\n=== Model's response ===`);
  console.log(result.text);
}

main().catch(console.error);
