import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";

export function printPrompt(label: string, prompt: LanguageModelV3Prompt): void {
  console.log(`\n${label} (${prompt.length} messages)`);
  for (const [index, message] of prompt.entries()) {
    printMessage(index, message);
  }
}

function printMessage(index: number, message: LanguageModelV3Message): void {
  if (message.role === "system") {
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    const tag = (message.providerOptions?.contextManagement as Record<string, unknown>)?.type === "summary"
      ? " [summary]"
      : "";
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
