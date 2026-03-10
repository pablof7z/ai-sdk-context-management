import type { CompressionSegment, ContextCompressionMessage, ContextMessage } from "ai-sdk-context-management";
import { contextCompression } from "ai-sdk-context-management";

export type ExampleMessage = ContextCompressionMessage;

let nextMessageId = 1;
let nextToolCallId = 1;

function createMessageId(): string {
  return `msg-${nextMessageId++}`;
}

export function resetIds(): void {
  nextMessageId = 1;
  nextToolCallId = 1;
}

export function textMessage(role: "user" | "assistant", text: string): ExampleMessage {
  return {
    id: createMessageId(),
    role,
    content: [{ type: "text", text }],
  };
}

export function makeConversationTurns(
  turns: Array<{ user: string; assistant: string }>,
  systemText?: string
): ExampleMessage[] {
  const messages: ExampleMessage[] = [];

  if (systemText) {
    messages.push({ id: createMessageId(), role: "system", content: systemText });
  }

  for (const turn of turns) {
    messages.push(textMessage("user", turn.user));
    messages.push(textMessage("assistant", turn.assistant));
  }

  return messages;
}

export function makeToolExchange(options: {
  toolName: string;
  input: unknown;
  output: string;
  toolCallId?: string;
}): ExampleMessage[] {
  const toolCallId = options.toolCallId ?? `${options.toolName}-call-${nextToolCallId++}`;

  return [
    {
      id: createMessageId(),
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId,
        toolName: options.toolName,
        input: options.input,
      }],
    },
    {
      id: createMessageId(),
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId,
        toolName: options.toolName,
        output: { type: "text", value: options.output },
      }],
    },
  ];
}

export function makeLargeText(label: string, lineCount: number): string {
  const lines: string[] = [];

  for (let index = 1; index <= lineCount; index++) {
    lines.push(
      `${label} ${index}: preserve the concrete detail, why it mattered, and what needs follow-up.`
    );
  }

  return lines.join("\n");
}

export function describeMessage(message: ExampleMessage): string {
  if (message.role === "system") {
    return `${message.id} system/text`;
  }

  const firstPart = message.content[0];
  if (!firstPart) {
    return `${message.id} ${message.role}/empty`;
  }

  if (firstPart.type === "text") {
    return `${message.id} ${message.role}/text`;
  }

  if (firstPart.type === "tool-call") {
    return `${message.id} ${message.role}/tool-call:${firstPart.toolName}`;
  }

  if (firstPart.type === "tool-result") {
    return `${message.id} ${message.role}/tool-result:${firstPart.toolName}`;
  }

  return `${message.id} ${message.role}/${firstPart.type}`;
}

export function previewMessage(message: ExampleMessage): string {
  if (message.role === "system") {
    return message.content;
  }

  const firstPart = message.content[0];
  if (!firstPart) {
    return "";
  }

  if (firstPart.type === "text") {
    return firstPart.text;
  }

  if (firstPart.type === "tool-call") {
    return `${firstPart.toolName}(${JSON.stringify(firstPart.input)})`;
  }

  if (firstPart.type === "tool-result" && firstPart.output?.type === "text") {
    return firstPart.output.value;
  }

  return JSON.stringify(firstPart);
}

export function printMessages(label: string, messages: ExampleMessage[]): void {
  console.log(`${label}: ${messages.length} messages`);
  for (const [index, message] of messages.entries()) {
    const preview = previewMessage(message).replace(/\s+/g, " ").slice(0, 110);
    console.log(`  [${index}] ${describeMessage(message)} ${preview}${preview.length === 110 ? "..." : ""}`);
  }
}

export function printContextMessages(label: string, messages: ContextMessage[]): void {
  console.log(`${label}: ${messages.length} entries`);
  for (const [index, message] of messages.entries()) {
    const preview = message.content.replace(/\s+/g, " ").slice(0, 110);
    console.log(`  [${index}] ${message.role}/${message.entryType}/${message.id} ${preview}${preview.length === 110 ? "..." : ""}`);
  }
}

export function printSegments(label: string, segments: CompressionSegment[]): void {
  console.log(`${label}: ${segments.length} segments`);
  for (const [index, segment] of segments.entries()) {
    console.log(`  [${index}] ${segment.fromId} -> ${segment.toId}: ${segment.compressed}`);
  }
}

export async function runContextCompression(
  config: Parameters<typeof contextCompression>[0]
): Promise<Awaited<ReturnType<typeof contextCompression>>> {
  return contextCompression(config);
}
