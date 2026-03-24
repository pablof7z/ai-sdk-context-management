/**
 * Model-Backed Summarization — use SummarizationStrategy with a built-in model-backed summarizer
 */
import type { ModelMessage } from "ai";
import {
  SummarizationStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import { printPrompt, runPreparedDemo } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new SummarizationStrategy({
        model: createMockTextModel(
          "Key findings: parser handles JSON and YAML, but edge cases remain around trailing commas."
        ),
        maxPromptTokens: 40,
        preserveRecentMessages: 2,
      }),
    ],
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are debugging a parser migration." },
    { role: "user", content: "We support JSON today." },
    { role: "assistant", content: "Understood." },
    { role: "user", content: "We also need YAML before release." },
    { role: "assistant", content: "I will track both formats." },
    { role: "user", content: "What is still risky?" },
  ];

  const { result, capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "The LLM-produced summary preserved the older parser discussion.",
  });

  printPrompt("Prompt after model-backed SummarizationStrategy", capturedPrompts[0]);
  console.log("\nWhat changed:");
  console.log("- older turns were replaced by a model-generated summary");
  console.log("- the latest question stayed raw");
  console.log("- the agent keeps salient facts without replaying the whole transcript");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
