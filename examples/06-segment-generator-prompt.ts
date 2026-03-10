/**
 * Example 06: Customizing the segment-generation prompt.
 *
 * This example shows three layers:
 * - the exported default prompt template
 * - the helper that expands the default placeholders
 * - `createSegmentGenerator({ promptTemplate })` for a custom prompt
 */
import {
  buildDefaultSegmentPrompt,
  createSegmentGenerator,
  createTranscript,
  DEFAULT_SEGMENT_PROMPT_TEMPLATE,
} from "ai-sdk-context-management";
import type { ContextMessage } from "ai-sdk-context-management";
import { printSegments } from "./helpers.js";

async function main() {
  console.log("=== Example 06: Segment generator prompt ===\n");

  const messages: ContextMessage[] = [
    { id: "msg-1", role: "user", entryType: "text", content: "Summarize the migration plan." },
    {
      id: "msg-2",
      role: "assistant",
      entryType: "text",
      content: "The rollout is staged, reversible, and still waiting on one regression test.",
    },
  ];

  const input = {
    transcript: createTranscript(messages),
    targetTokens: 80,
    messages,
    previousSegments: [],
  };

  console.log("default template preview:");
  console.log(DEFAULT_SEGMENT_PROMPT_TEMPLATE.split("\n").slice(0, 8).join("\n"));

  console.log("\nexpanded default prompt:");
  console.log(buildDefaultSegmentPrompt(input));

  let capturedPrompt = "";
  const generator = createSegmentGenerator({
    promptTemplate: [
      "Compress this transcript into exact replacement segments.",
      "Return strict JSON with a segments array.",
      "Budget: {{targetTokens}} tokens.",
      "First id: {{firstId}}.",
      "Last id: {{lastId}}.",
      "",
      "{{transcript}}",
    ].join("\n"),
    async generate(promptText) {
      capturedPrompt = promptText;
      return JSON.stringify({
        segments: [{
          fromId: input.transcript.firstId,
          toId: input.transcript.lastId,
          compressed: "Migration summary: staged rollout, reversible deployment, one regression test still pending.",
        }],
      });
    },
  });

  const segments = await generator.generate(input);

  console.log("\ncustom prompt sent to the generator:");
  console.log(capturedPrompt);
  printSegments("\nsegments returned by the generator", segments);
}

main().catch(console.error);
