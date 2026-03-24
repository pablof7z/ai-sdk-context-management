/**
 * Sliding Window — keep the recent tail, or preserve a head plus tail
 */
import type { ModelMessage } from "ai";
import {
  SlidingWindowStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import { printPrompt, runPreparedDemo } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [new SlidingWindowStrategy({ keepLastMessages: 4 })],
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a helpful geography assistant." },
    { role: "user", content: "What is the capital of France?" },
    { role: "assistant", content: "Paris." },
    { role: "user", content: "What about Germany?" },
    { role: "assistant", content: "Berlin." },
    { role: "user", content: "And Italy?" },
    { role: "assistant", content: "Rome." },
    { role: "user", content: "List every capital I asked about." },
  ];

  const { result, capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "Only Germany and Italy are still visible.",
  });

  printPrompt("Prompt after SlidingWindowStrategy", capturedPrompts[0]);
  console.log("\nWhat changed:");
  console.log("- only the last 4 non-system messages survive");
  console.log("- the France exchange is gone before the model answers");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
