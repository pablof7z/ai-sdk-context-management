/**
 * Tool Result Decay — keep reasoning, compress older tool payloads
 */
import { generateText, wrapLanguageModel, type ModelMessage } from "ai";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import {
  ToolResultDecayStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import {
  DEMO_CONTEXT,
  createMockTextModel,
  createPromptCaptureMiddleware,
  printPrompt,
} from "./helpers.js";

const LOOKUPS = [
  {
    id: "c1",
    query: "Rust ownership",
    result:
      "Rust's ownership system gives each value exactly one owner and drops the value when that owner leaves scope.",
  },
  {
    id: "c2",
    query: "Rust lifetimes",
    result:
      "Lifetimes tell the compiler how long references stay valid and prevent dangling references.",
  },
  {
    id: "c3",
    query: "Rust traits",
    result:
      "Traits define shared behavior and support default implementations plus generic bounds.",
  },
  {
    id: "c4",
    query: "Rust async",
    result:
      "Rust async compiles futures into state machines and executors poll them to completion.",
  },
  {
    id: "c5",
    query: "Rust error handling",
    result:
      "Rust uses Result<T, E> for recoverable errors and the ? operator to propagate them ergonomically.",
  },
];

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new ToolResultDecayStrategy({
        keepFullResultCount: 1,
        truncateWindowCount: 2,
        truncatedMaxTokens: 12,
        placeholder: "[result omitted]",
      }),
    ],
  });

  const capturedPrompts: LanguageModelV3Prompt[] = [];
  const model = wrapLanguageModel({
    model: wrapLanguageModel({
      model: createMockTextModel("I can only quote the newest lookup in full."),
      middleware: createPromptCaptureMiddleware(capturedPrompts),
    }),
    middleware: runtime.middleware,
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a Rust programming expert." },
    { role: "user", content: "Look up the core Rust concepts, then summarize them." },
  ];

  for (const lookup of LOOKUPS) {
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: lookup.id,
          toolName: "lookup",
          input: { query: lookup.query },
        },
      ],
    });
    messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: lookup.id,
          toolName: "lookup",
          output: { type: "text", value: lookup.result },
        },
      ],
    });
  }

  messages.push({ role: "user", content: "What matters most?" });

  const result = await generateText({
    model,
    messages,
    providerOptions: DEMO_CONTEXT,
  });

  printPrompt("Prompt after ToolResultDecayStrategy", capturedPrompts[0]);
  console.log("\nWhat changed:");
  console.log("- the newest tool result stays full");
  console.log("- the middle results are shortened");
  console.log("- the oldest results become [result omitted]");
  console.log("- tool calls still remain, so the reasoning chain survives");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
