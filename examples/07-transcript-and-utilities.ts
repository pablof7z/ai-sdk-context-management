/**
 * Example 07: Transcript and segment utilities.
 *
 * This example stays below the preprocessing layer and works directly with ContextMessage entries.
 */
import {
  applySegments,
  buildSummaryMessage,
  createTranscript,
  validateSegments,
} from "ai-sdk-context-management";
import type { ContextMessage, TranscriptRenderOptions, TranscriptRenderResult, TranscriptRenderer } from "ai-sdk-context-management";
import { printContextMessages, printSegments } from "./helpers.js";

const plainTextRenderer: TranscriptRenderer = {
  render(messages, _options?: TranscriptRenderOptions): TranscriptRenderResult {
    const shortIdMap = new Map(messages.map((message) => [message.id, message.id]));

    return {
      text: messages.map((message) => `${message.id} | ${message.role}/${message.entryType} | ${message.content}`).join("\n"),
      shortIdMap,
      firstId: messages[0]?.id ?? null,
      lastId: messages[messages.length - 1]?.id ?? null,
    };
  },
};

async function main() {
  console.log("=== Example 07: Transcript and utility helpers ===\n");

  const messages: ContextMessage[] = [
    { id: "msg-1", role: "system", entryType: "text", content: "You are a code review assistant." },
    { id: "msg-2", role: "user", entryType: "text", content: "Summarize the code review context before the tool output." },
    { id: "msg-3", role: "assistant", entryType: "text", content: "I will keep the final recommendation near the tail." },
    {
      id: "msg-4",
      role: "assistant",
      entryType: "tool-call",
      toolCallId: "call-1",
      toolName: "fs_read",
      content: 'fs_read({"path":"src/service.ts"})',
    },
    {
      id: "msg-5",
      role: "tool",
      entryType: "tool-result",
      toolCallId: "call-1",
      toolName: "fs_read",
      content: "export async function loadSession() { return await store.get(sessionId); }",
    },
  ];

  printContextMessages("context messages", messages);

  const defaultTranscript = createTranscript(messages);
  console.log("\ndefault transcript:");
  console.log(defaultTranscript.text);

  const customTranscript = createTranscript(messages, { renderer: plainTextRenderer });
  console.log("\ncustom transcript renderer output:");
  console.log(customTranscript.text);

  const segment = {
    fromId: "msg-2",
    toId: "msg-4",
    compressed: "Earlier discussion established the review context and queued a file read for supporting evidence.",
  };

  console.log("\nsegment validation result:");
  console.log(validateSegments(messages, [segment]));

  const rewrittenMessages = applySegments(messages, [segment]);
  printContextMessages("\nmessages after applySegments", rewrittenMessages);
  printSegments("\nsegment list", [segment]);

  console.log("\nsummary message preview:");
  console.log(buildSummaryMessage(segment));
}

main().catch(console.error);
