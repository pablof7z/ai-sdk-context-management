/**
 * System Prompt Caching — consolidate and stabilize the prompt prefix
 */
import type { ModelMessage } from "ai";
import {
  SystemPromptCachingStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import { printPrompt, runPreparedDemo } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [new SystemPromptCachingStrategy()],
  });

  const messages: ModelMessage[] = [
    { role: "user", content: "Can you review the parser changes?" },
    { role: "system", content: "You are a careful code reviewer." },
    { role: "assistant", content: "Yes." },
    { role: "system", content: "Prefer concise findings with concrete file references." },
    { role: "user", content: "Start with parser.ts." },
  ];

  const { result, capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "The prompt prefix is now stable.",
  });

  printPrompt("Prompt after SystemPromptCachingStrategy", capturedPrompts[0]);
  console.log("\nWhat changed:");
  console.log("- both system messages moved to the front");
  console.log("- the plain system messages were merged into one stable prefix");
  console.log("- non-system message order stayed intact");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
