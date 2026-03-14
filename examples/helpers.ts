import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Middleware,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";

export const DEMO_CONTEXT = {
  contextManagement: {
    conversationId: "demo-conversation",
    agentId: "demo-agent",
    agentLabel: "Demo Agent",
  },
};

export function usage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 10,
      text: 10,
      reasoning: undefined,
    },
  };
}

export function createMockTextModel(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usage(),
      warnings: [],
    }),
  });
}

export function createPromptCaptureMiddleware(
  capturedPrompts: LanguageModelV3Prompt[]
): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      capturedPrompts.push(structuredClone(params.prompt));
      return params;
    },
  };
}

export function printPrompt(label: string, prompt: LanguageModelV3Prompt): void {
  console.log(`\n${label} (${prompt.length} messages)`);
  for (const [index, message] of prompt.entries()) {
    printMessage(index, message);
  }
}

function printMessage(index: number, message: LanguageModelV3Message): void {
  if (message.role === "system") {
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    const type = (message.providerOptions?.contextManagement as Record<string, unknown>)?.type;
    const tag = typeof type === "string" ? ` [${type}]` : "";
    console.log(`  [${index}] system${tag}: ${truncate(text, 120)}`);
    return;
  }

  if (message.role === "user") {
    const text = message.content.map(p => p.type === "text" ? p.text : `[${p.type}]`).join("");
    console.log(`  [${index}] user: ${truncate(text, 120)}`);
    return;
  }

  if (message.role === "assistant") {
    for (const part of message.content) {
      if (part.type === "text") {
        console.log(`  [${index}] assistant: ${truncate(part.text, 120)}`);
      } else if (part.type === "tool-call") {
        console.log(`  [${index}] assistant -> ${part.toolName}(${truncate(JSON.stringify(part.input), 60)})`);
      }
    }
    return;
  }

  if (message.role === "tool") {
    for (const part of message.content) {
      if (part.type === "tool-result") {
        const output = part.output.type === "text" ? part.output.value : JSON.stringify(part.output);
        console.log(`  [${index}] tool(${part.toolName}): ${truncate(output, 100)}`);
      }
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}
