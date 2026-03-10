/**
 * Shared helpers for generating synthetic AI SDK v3-style prompt messages.
 */
export type ExamplePromptMessage =
  | { role: "system"; content: string; providerOptions?: Record<string, unknown> }
  | {
      role: "user" | "assistant";
      content: Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }>;
      providerOptions?: Record<string, unknown>;
    }
  | {
      role: "tool";
      content: Array<{ type: "tool-result"; toolCallId: string; toolName: string; output: { type: "text"; value: string } }>;
      providerOptions?: Record<string, unknown>;
    };

export function generateConversation(turns: number): ExamplePromptMessage[] {
  const messages: ExamplePromptMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: `User message ${i + 1}: ${generatePadding(50)}` }],
    });
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: `Assistant response ${i + 1}: ${generatePadding(70)}` }],
    });
  }
  return messages;
}

export function generateToolExchange(toolName: string, outputWords: number): ExamplePromptMessage[] {
  const toolCallId = `call_${toolName}_${Math.random().toString(36).slice(2, 8)}`;
  return [
    {
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId,
        toolName,
        input: { query: `test query for ${toolName}` },
      }],
    },
    {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value: generatePadding(outputWords) },
      }],
    },
  ];
}

export function generatePadding(words: number): string {
  const vocab = [
    "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
    "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing",
    "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "labore",
    "magna", "aliqua", "enim", "minim", "veniam", "quis", "nostrud",
    "exercitation", "ullamco", "laboris", "nisi", "aliquip", "commodo",
    "consequat", "duis", "aute", "irure", "reprehenderit", "voluptate",
    "velit", "esse", "cillum", "fugiat", "nulla", "pariatur", "excepteur",
    "sint", "occaecat", "cupidatat", "proident", "sunt", "culpa", "officia",
    "deserunt", "mollit", "anim", "id", "est",
  ];
  const result: string[] = [];
  for (let i = 0; i < words; i++) {
    result.push(vocab[i % vocab.length]);
  }
  return result.join(" ");
}

export function getTextContent(message: ExamplePromptMessage): string {
  if (message.role === "system") {
    return message.content;
  }

  const parts = message.content;
  const textPart = parts.find((part) => part.type === "text");
  if (textPart && textPart.type === "text") {
    return textPart.text;
  }

  const toolCallPart = parts.find((part) => part.type === "tool-call");
  if (toolCallPart && toolCallPart.type === "tool-call") {
    return `${toolCallPart.toolName}(${JSON.stringify(toolCallPart.input)})`;
  }

  const toolResultPart = parts.find((part) => part.type === "tool-result");
  if (toolResultPart && toolResultPart.type === "tool-result") {
    return toolResultPart.output.value;
  }

  return JSON.stringify(parts);
}

export async function runMiddlewareTransform(
  middleware: { transformParams?: (input: any) => PromiseLike<any> },
  prompt: ExamplePromptMessage[],
  providerOptions?: Record<string, unknown>
): Promise<ExamplePromptMessage[]> {
  if (!middleware.transformParams) {
    throw new Error("Middleware does not expose transformParams");
  }

  const result = await middleware.transformParams({
    type: "generate-text",
    params: {
      prompt,
      providerOptions,
    },
    model: {
      provider: "example",
      modelId: "demo-model",
    },
  } as any);

  return result.prompt as ExamplePromptMessage[];
}

export function printPrompt(label: string, prompt: ExamplePromptMessage[]): void {
  console.log(`${label}: ${prompt.length} messages`);
  for (const [index, message] of prompt.entries()) {
    const preview = getTextContent(message).replace(/\s+/g, " ").slice(0, 100);
    console.log(`  [${index}] ${message.role}: ${preview}${preview.length === 100 ? "..." : ""}`);
  }
}
