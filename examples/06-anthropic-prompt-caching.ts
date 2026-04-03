/**
 * Anthropic Prompt Caching — reuse naturally stable leading prompt history
 */
import type { ModelMessage } from "ai";
import {
  AnthropicPromptCachingStrategy,
  createContextManagementRuntime,
} from "ai-sdk-context-management";
import { prepareDemoRequest, printPrompt } from "./helpers.js";

async function main() {
  const runtime = createContextManagementRuntime({
    strategies: [
      new AnthropicPromptCachingStrategy(),
    ],
  });

  const firstMessages: ModelMessage[] = [
    { role: "system", content: "You are a careful code reviewer." },
    { role: "user", content: "Repository context: parser.ts and tokenizer.ts." },
    { role: "assistant", content: "I reviewed the shared setup already." },
    { role: "user", content: "Review parser.ts." },
  ];
  const secondMessages: ModelMessage[] = [
    { role: "system", content: "You are a careful code reviewer." },
    { role: "user", content: "Repository context: parser.ts and tokenizer.ts." },
    { role: "assistant", content: "I reviewed the shared setup already." },
    { role: "user", content: "Review tokenizer.ts." },
  ];

  await prepareDemoRequest({
    runtime,
    messages: firstMessages,
    model: {
      provider: "anthropic",
      modelId: "claude-test",
    },
  });
  const prepared = await prepareDemoRequest({
    runtime,
    messages: secondMessages,
    model: {
      provider: "anthropic",
      modelId: "claude-test",
    },
  });

  printPrompt("Prompt after AnthropicPromptCachingStrategy", prepared.messages as never);
  const breakpointIndex = prepared.messages.findIndex(
    (message) => typeof message.providerOptions?.anthropic === "object"
      && message.providerOptions?.anthropic !== null
      && "cacheControl" in message.providerOptions.anthropic
  );

  console.log("\nWhat changed:");
  console.log(`- the second request marked message [${breakpointIndex}] as the Anthropic cache breakpoint`);
  console.log("- the breakpoint landed on the last unchanged leading message");
  console.log("- the changing user turn stayed outside the cached breakpoint");
}

main().catch(console.error);
