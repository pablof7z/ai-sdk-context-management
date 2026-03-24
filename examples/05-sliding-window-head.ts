/**
 * Sliding Window with head preservation — keep setup plus the latest turns
 */
import type { ModelMessage } from "ai";
import {
  SlidingWindowStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import { printPrompt, runPreparedDemo } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [new SlidingWindowStrategy({ headCount: 2, keepLastMessages: 2 })],
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are an implementation agent." },
    { role: "user", content: "We are migrating billing to a new provider." },
    { role: "assistant", content: "I will preserve the migration requirements." },
    { role: "user", content: "Status update: mapped old invoice fields." },
    { role: "assistant", content: "Noted." },
    { role: "user", content: "Status update: updated the webhook schema." },
    { role: "assistant", content: "Noted." },
    { role: "user", content: "Current blocker: refunds fail when the provider omits a charge ID." },
  ];

  const { result, capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "I still have the original brief and the current blocker.",
  });

  printPrompt("Prompt after SlidingWindowStrategy({ headCount: 2, keepLastMessages: 2 })", capturedPrompts[0]);
  console.log("\nWhat changed:");
  console.log("- the opening brief stayed in the prompt");
  console.log("- the middle status updates were dropped");
  console.log("- the latest blocker stayed verbatim");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
