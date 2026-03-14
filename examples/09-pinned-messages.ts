/**
 * Pinned Messages — protect specific tool results from later pruning
 */
import { generateText, wrapLanguageModel, type ModelMessage } from "ai";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import {
  PinnedMessagesStrategy,
  ToolResultDecayStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import {
  DEMO_CONTEXT,
  createMockTextModel,
  createPromptCaptureMiddleware,
  printPrompt,
} from "./helpers.js";

async function main() {
  const pinned = new Map<string, string[]>();
  const runtime = createContextManagementRuntime({
    strategies: [
      new PinnedMessagesStrategy({
        pinnedStore: {
          get: ({ conversationId, agentId }) =>
            pinned.get(`${conversationId}:${agentId}`) ?? [],
          set: ({ conversationId, agentId }, toolCallIds) => {
            pinned.set(`${conversationId}:${agentId}`, toolCallIds);
          },
        },
      }),
      new ToolResultDecayStrategy({
        keepFullResultCount: 0,
        truncateWindowCount: 0,
        placeholder: "[result omitted]",
      }),
    ],
  });

  const toolResult = await ((runtime.optionalTools.pin_tool_result as unknown) as {
    execute: (
      input: { pin: string[] },
      options: { experimental_context: unknown }
    ) => Promise<unknown>;
  }).execute(
    { pin: ["call-1"] },
    { experimental_context: DEMO_CONTEXT }
  );

  const capturedPrompts: LanguageModelV3Prompt[] = [];
  const model = wrapLanguageModel({
    model: wrapLanguageModel({
      model: createMockTextModel("The pinned result stayed available even though the others decayed."),
      middleware: createPromptCaptureMiddleware(capturedPrompts),
    }),
    middleware: runtime.middleware,
  });

  const messages: ModelMessage[] = [
    { role: "system", content: "You are debugging a build failure." },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: { path: "build.log" } }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: { type: "text", value: "Error: missing NODE_ENV in production build." },
      }],
    },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call-2", toolName: "read_file", input: { path: "config.ts" } }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "call-2",
        toolName: "read_file",
        output: { type: "text", value: "config details that are now less important" },
      }],
    },
    { role: "user", content: "What is the likely cause?" },
  ];

  const result = await generateText({
    model,
    messages,
    providerOptions: DEMO_CONTEXT,
  });

  printPrompt("Prompt after PinnedMessagesStrategy + ToolResultDecayStrategy", capturedPrompts[0]);
  console.log("\nTool result from pin_tool_result(...):");
  console.log(JSON.stringify(toolResult, null, 2));
  console.log("\nWhat changed:");
  console.log("- call-1 stayed intact because it was pinned");
  console.log("- call-2 decayed into a placeholder");
  console.log("- the agent keeps the one result it decided matters");
  console.log(`\nModel output: ${result.text}`);
}

main().catch(console.error);
