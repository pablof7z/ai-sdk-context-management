/**
 * Tool Result Decay — Progressive compression of tool outputs
 *
 * Simulates an agent that made 5 lookup calls. The ToolResultDecayStrategy
 * divides results into three zones based on recency:
 *   - Full:      most recent results kept verbatim
 *   - Truncated: middle-age results trimmed to a token limit
 *   - Placeholder: oldest results replaced with a short marker
 *
 * Requires: ollama running locally with qwen2.5:3b pulled
 */
import { generateText, wrapLanguageModel, type ModelMessage } from "ai";
import type { LanguageModelV3Middleware, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { ollama } from "ollama-ai-provider-v2";
import { createContextManagementRuntime, ToolResultDecayStrategy } from "ai-sdk-context-management";
import { printPrompt } from "./helpers.js";

const CONTEXT_OPTIONS = {
  contextManagement: { conversationId: "demo", agentId: "demo" },
};

// Simulated tool results of varying length
const LOOKUPS = [
  { id: "c1", query: "Rust ownership", result: "Rust's ownership system ensures memory safety without a garbage collector. Each value has exactly one owner, and when the owner goes out of scope the value is dropped. Borrowing rules allow references without taking ownership." },
  { id: "c2", query: "Rust lifetimes", result: "Lifetimes in Rust are annotations that tell the compiler how long references are valid. They prevent dangling references by ensuring borrowed data outlives the borrower. Most lifetimes are inferred automatically." },
  { id: "c3", query: "Rust traits", result: "Traits define shared behavior. They are similar to interfaces in other languages but support default implementations and can be used as trait bounds for generics. Orphan rules prevent conflicts." },
  { id: "c4", query: "Rust async", result: "Rust async/await is zero-cost — futures are state machines compiled at build time. An executor like tokio polls futures to completion. Pin ensures self-referential futures stay in place." },
  { id: "c5", query: "Rust error handling", result: "Rust uses Result<T, E> for recoverable errors and panic! for unrecoverable ones. The ? operator propagates errors ergonomically. Custom error types typically implement the Error trait." },
];

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new ToolResultDecayStrategy({
        keepFullResultCount: 1,    // only the most recent stays full
        truncateWindowCount: 2,    // next 2 get truncated
        truncatedMaxTokens: 20,    // ~80 chars after truncation
        placeholder: "[result omitted]",
      }),
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

  // Build a conversation as if an agent made 5 sequential lookup calls
  const messages: ModelMessage[] = [
    { role: "system", content: "You are a Rust programming expert. You have a lookup tool for reference material." },
    { role: "user", content: "I want to understand Rust's key concepts. Let me look a few things up." },
  ];

  for (const lookup of LOOKUPS) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: lookup.id, toolName: "lookup", input: { query: lookup.query } }],
    });
    messages.push({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: lookup.id, toolName: "lookup", output: { type: "text", value: lookup.result } }],
    });
  }

  messages.push({ role: "user", content: "Now summarize what you found about Rust." });

  console.log("=== Conversation has 5 lookup results + final question ===");
  console.log("Strategy: keepFullResultCount=1, truncateWindowCount=2\n");
  console.log("Expected zones:");
  console.log("  c1, c2  → placeholder  (oldest)");
  console.log("  c3, c4  → truncated    (middle)");
  console.log("  c5      → full         (most recent)\n");

  const result = await generateText({
    model,
    messages,
    providerOptions: CONTEXT_OPTIONS,
  });

  printPrompt("What the model received", capturedPrompts[0]);

  console.log(`\n=== Model's response (only has full info from c5) ===`);
  console.log(result.text);
}

main().catch(console.error);
