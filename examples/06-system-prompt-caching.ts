/**
 * System Prompt Caching — consolidate and stabilize the prompt prefix
 */
import type { ModelMessage } from "ai";
import {
  createSharedPrefixTracker,
  SystemPromptCachingStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import { printPrompt, runPreparedDemo } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [new SystemPromptCachingStrategy()],
  });
  const tracker = createSharedPrefixTracker();

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
  const firstObservation = tracker.observe(capturedPrompts[0] as never);
  const secondObservation = tracker.observe(capturedPrompts[0] as never);

  printPrompt("Prompt after SystemPromptCachingStrategy", capturedPrompts[0]);
  console.log("\nWhat changed:");
  console.log("- both system messages moved to the front");
  console.log("- the plain system messages were merged into one stable prefix");
  console.log("- non-system message order stayed intact");
  console.log(`- first observation shared-prefix count: ${firstObservation.sharedPrefixMessageCount}`);
  console.log(`- second observation shared-prefix last index: ${secondObservation.lastSharedMessageIndex}`);
  console.log("- a host can now put a provider-specific cache breakpoint on that shared-prefix boundary");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
