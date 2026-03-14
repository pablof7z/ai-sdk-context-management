/**
 * Summarization — Auto-summarize older messages when context grows too large
 *
 * A science tutor conversation that grows past a token budget. The strategy
 * calls a summarize function (powered by Ollama itself) to compress older
 * exchanges into a summary message, keeping recent turns verbatim.
 *
 * This is the BYOLLM pattern: your own model handles both conversation
 * and summarization — no external API needed.
 *
 * Requires: ollama running locally with qwen2.5:3b pulled
 */
import { generateText, wrapLanguageModel, type ModelMessage } from "ai";
import type { LanguageModelV3Message, LanguageModelV3Middleware, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { ollama } from "ollama-ai-provider-v2";
import { createContextManagementRuntime, SummarizationStrategy } from "ai-sdk-context-management";
import { printPrompt } from "./helpers.js";

const CONTEXT_OPTIONS = {
  contextManagement: { conversationId: "demo", agentId: "demo" },
};

function extractText(message: LanguageModelV3Message): string {
  if (message.role === "system") return message.content;
  return message.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("");
}

async function summarizeWithOllama(messages: LanguageModelV3Message[]): Promise<string> {
  const transcript = messages
    .map((m) => {
      if (m.role === "system" && (m.providerOptions?.contextManagement as Record<string, unknown>)?.type === "summary") {
        return `[Previous Summary]: ${m.content}`;
      }
      return `${m.role}: ${extractText(m)}`;
    })
    .filter(Boolean)
    .join("\n");

  console.log("  [summarizer] Summarizing", messages.length, "messages with Ollama...");

  const result = await generateText({
    model: ollama("qwen2.5:3b"),
    messages: [
      {
        role: "system",
        content: "Summarize the following conversation in 2-3 sentences. Preserve all key facts, conclusions, and any specific details the user asked about.",
      },
      { role: "user", content: transcript },
    ],
  });

  console.log("  [summarizer] Summary:", result.text.slice(0, 100) + "...");
  return result.text;
}

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new SummarizationStrategy({
        summarize: summarizeWithOllama,
        maxPromptTokens: 300,
        keepLastMessages: 2,
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

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a science tutor. Give concise but informative explanations." },
  ];

  const turns = [
    "What is photosynthesis?",
    "How does cellular respiration relate to it?",
    "What role do mitochondria play in energy production?",
    "Based on everything we discussed, explain the full energy cycle in a cell.",
  ];

  for (const question of turns) {
    messages.push({ role: "user", content: question });

    console.log(`\n> User: ${question}`);

    const promptIndex = capturedPrompts.length;
    const result = await generateText({
      model,
      messages,
      providerOptions: CONTEXT_OPTIONS,
    });

    messages.push({ role: "assistant", content: result.text });
    console.log(`< Assistant: ${result.text.slice(0, 200)}${result.text.length > 200 ? "..." : ""}`);

    const actualPrompt = capturedPrompts[promptIndex];
    const hasSummary = actualPrompt.some(
      (m) => m.role === "system" && (m.providerOptions?.contextManagement as Record<string, unknown>)?.type === "summary"
    );

    console.log(`  [${actualPrompt.length} messages sent to model${hasSummary ? ", includes summary" : ""}]`);
  }

  // Show the final prompt structure
  const lastPrompt = capturedPrompts[capturedPrompts.length - 1];
  printPrompt("\nFinal turn — prompt structure", lastPrompt);

  console.log("\n---");
  console.log("When the conversation exceeds maxPromptTokens=300, older exchanges");
  console.log("are replaced with an Ollama-generated summary. The model can still");
  console.log("answer questions about earlier topics because the summary preserves key facts.");
}

main().catch(console.error);
