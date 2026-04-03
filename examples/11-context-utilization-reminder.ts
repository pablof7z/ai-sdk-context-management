/**
 * Context Utilization Reminder — tell the agent when to clean up context
 */
import type { ModelMessage } from "ai";
import type { LanguageModelV3Message } from "@ai-sdk/provider";
import {
  RemindersStrategy,
  createContextManagementRuntime,
  createDefaultPromptTokenEstimator,
} from "ai-sdk-context-management";
import { printPrompt, runPreparedDemo } from "./helpers.js";

function getUserText(message: LanguageModelV3Message): string {
  if (message.role === "system") {
    return message.content;
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .join("");
}

async function main() {
  const estimator = createDefaultPromptTokenEstimator();
  const runtime = createContextManagementRuntime({
    strategies: [
      new RemindersStrategy({
        contextUtilization: {
          budgetProfile: {
            tokenBudget: 40,
            estimator,
          },
          warningThresholdRatio: 0.5,
          mode: "generic",
        },
      }),
    ],
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a planning agent." },
    {
      role: "user",
      content:
        "We have reviewed the config, test setup, deployment script, rollback plan, parser edge cases, and the production checklist. What should happen next?",
    },
  ];

  const { result, capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "I should summarize stale context before continuing.",
  });

  printPrompt("Prompt after RemindersStrategy", capturedPrompts[0]);
  console.log("\nLatest user message after reminder injection:");
  console.log(getUserText(capturedPrompts[0][capturedPrompts[0].length - 1]));
  console.log("\nWhat changed:");
  console.log("- the agent received an explicit utilization warning");
  console.log("- no history was removed yet");
  console.log("- this is a nudge to summarize or compact before the next expensive turn");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
