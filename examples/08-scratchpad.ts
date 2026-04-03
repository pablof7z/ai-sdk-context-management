/**
 * Scratchpad — let the agent maintain structured working state across turns
 */
import type { ModelMessage } from "ai";
import type { ScratchpadState, ScratchpadToolInput } from "ai-sdk-context-management";
import {
  ScratchpadStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import {
  DEMO_CONTEXT,
  printPrompt,
  runPreparedDemo,
} from "./helpers.js";

async function main() {
  const scratchpads = new Map<string, ScratchpadState>();
  scratchpads.set("demo-conversation:planner", {
    entries: {
      objective: "Finish parser review",
      status: "API review complete, waiting on parser validation.",
    },
    agentLabel: "Planner",
  });

  const runtime = createContextManagementRuntime({
    strategies: [
      new ScratchpadStrategy({
        scratchpadStore: {
          get: ({ conversationId, agentId }) =>
            scratchpads.get(`${conversationId}:${agentId}`),
          set: ({ conversationId, agentId }, state) => {
            scratchpads.set(`${conversationId}:${agentId}`, state);
          },
          listConversation: (conversationId) =>
            [...scratchpads.entries()]
              .filter(([key]) => key.startsWith(`${conversationId}:`))
              .map(([key, state]) => ({
                agentId: key.split(":")[1],
                agentLabel: state.agentLabel,
                state,
              })),
        },
      }),
    ],
  });

  const toolResult = await ((runtime.optionalTools.scratchpad as unknown) as {
    execute: (
      input: ScratchpadToolInput,
      options: { experimental_context: unknown }
    ) => Promise<unknown>;
  }).execute(
    {
      description: "Capture parser findings",
      setEntries: {
        finding: "Parser edge case is around trailing commas.",
        nextStep: "Re-check trailing comma handling in parser.ts.",
        notes: "Reviewer: keep the parser follow-up visible in scratchpad state.",
      },
      preserveTurns: 1,
    },
    {
      toolCallId: "scratchpad-demo-call-1",
      messages: [
        { role: "system", content: "You are a code review agent." },
        { role: "user", content: "Continue the parser review." },
      ],
      experimental_context: DEMO_CONTEXT,
    }
  );

  const messages: ModelMessage[] = [
    { role: "system", content: "You are a code review agent." },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call-old", toolName: "read_file", input: { path: "parser.ts" } }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "call-old",
        toolName: "read_file",
        output: { type: "text", value: "legacy parser contents" },
      }],
    },
    { role: "user", content: "Continue the parser review." },
  ];

  const { result, capturedPrompts } = await runPreparedDemo({
    runtime,
    messages,
    responseText: "I still have the notes even though the old tool output is gone.",
  });

  printPrompt("Prompt after ScratchpadStrategy", capturedPrompts[0]);
  console.log("\nTool result from scratchpad(...):");
  console.log(JSON.stringify(toolResult, null, 2));
  console.log("\nWhat changed:");
  console.log("- the latest user message gained a scratchpad reminder block");
  console.log("- scratchpad entries, including a notes key, were injected into the reminder block");
  console.log("- other agents' scratchpads were injected with attribution");
  console.log("- the earlier tool exchange is still present unless another strategy compacts it");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
