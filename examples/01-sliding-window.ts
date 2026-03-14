/**
 * Sliding Window — Multi-turn chat with context eviction
 *
 * A geography Q&A where we accumulate messages across turns.
 * With keepLastMessages: 4, older exchanges fall out of the window.
 * By turn 4 the model can no longer recall France — it was evicted.
 *
 * Requires: ollama running locally with qwen2.5:3b pulled
 */
import { generateText, wrapLanguageModel, type ModelMessage } from "ai";
import type { LanguageModelV3Middleware, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { ollama } from "ollama-ai-provider-v2";
import { createContextManagementRuntime, SlidingWindowStrategy } from "ai-sdk-context-management";
import { printPrompt } from "./helpers.js";

const CONTEXT_OPTIONS = {
  contextManagement: { conversationId: "demo", agentId: "demo" },
};

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [new SlidingWindowStrategy({ keepLastMessages: 4 })],
  });

  // Capture the prompt after context management so we can inspect it
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

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a helpful geography assistant. Keep answers to one sentence." },
  ];

  const turns = [
    "What's the capital of France?",
    "What about Germany?",
    "And Italy?",
    "Now list ALL the capitals I asked about in this conversation.",
  ];

  for (const question of turns) {
    messages.push({ role: "user", content: question });

    console.log(`\n> User: ${question}`);

    const result = await generateText({
      model,
      messages,
      providerOptions: CONTEXT_OPTIONS,
    });

    messages.push({ role: "assistant", content: result.text });
    console.log(`< Assistant: ${result.text}`);
  }

  // Show what the model actually received on the final turn
  const lastPrompt = capturedPrompts[capturedPrompts.length - 1];
  printPrompt("\nFinal turn — what the model actually received", lastPrompt);

  console.log("\n---");
  console.log("With keepLastMessages=4, only the last 4 non-system messages survive.");
  console.log("The France Q&A (messages 1-2) was evicted before turn 4,");
  console.log("so the model can only recall Germany and Italy.");
}

main().catch(console.error);
