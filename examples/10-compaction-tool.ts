/**
 * Compaction Tool — let the agent request compaction explicitly
 */
import type { ModelMessage } from "ai";
import {
  CompactionToolStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import {
  DEMO_CONTEXT,
  printPrompt,
  runPreparedDemo,
} from "./helpers.js";

async function main() {
  const summaries = new Map<string, string>();
  const runtime = createContextManagementRuntime({
    strategies: [
      new CompactionToolStrategy({
        summarize: async () =>
          "Compacted summary: config uses port 3000, tests bootstrap a DB, parser issue remains around trailing commas.",
        keepLastMessages: 2,
        compactionStore: {
          get: ({ conversationId, agentId }) =>
            summaries.get(`${conversationId}:${agentId}`),
          set: ({ conversationId, agentId }, summary) => {
            summaries.set(`${conversationId}:${agentId}`, summary);
          },
        },
      }),
    ],
  });

  const toolResult = await ((runtime.optionalTools.compact_context as unknown) as {
    execute: (
      input: Record<string, never>,
      options: { experimental_context: unknown }
    ) => Promise<unknown>;
  }).execute(
    {},
    { experimental_context: DEMO_CONTEXT }
  );

  const messages: ModelMessage[] = [
    { role: "system", content: "You are analyzing a TypeScript service." },
    { role: "user", content: "Read config.json." },
    { role: "assistant", content: "Port 3000, localhost, debug enabled." },
    { role: "user", content: "Read test/setup.ts." },
    { role: "assistant", content: "Tests create and clean up a database." },
    { role: "user", content: "What should we fix next?" },
  ];

  const firstRun = await runPreparedDemo({
    runtime,
    messages,
    responseText: "The compacted summary is enough to continue.",
  });

  const secondRun = await runPreparedDemo({
    runtime,
    messages: [
      { role: "system", content: "You are analyzing a TypeScript service." },
      { role: "user", content: "Continue from the previous investigation." },
    ],
    responseText: "The compacted summary is enough to continue.",
  });

  printPrompt("Prompt on the compaction turn", firstRun.capturedPrompts[0]);
  printPrompt("Prompt on the following turn", secondRun.capturedPrompts[0]);
  console.log("\nTool result from compact_context(...):");
  console.log(JSON.stringify(toolResult, null, 2));
  console.log("\nWhat changed:");
  console.log("- the first call replaced older messages with a compaction summary");
  console.log("- the second call re-injected the stored summary before the new request");
  console.log("- the agent decides when to compact instead of waiting for a token threshold");
}

main().catch(console.error);
