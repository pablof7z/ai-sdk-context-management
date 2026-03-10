/**
 * Example 05: Pure manageContext() usage without AI SDK middleware.
 */
import { createTranscript, manageContext } from "ai-sdk-context-mgmt-middleware";

async function main() {
  console.log("=== Example 05: manageContext() ===\n");

  const input = [
    { role: "user" as const, content: "We need to migrate Tenex compression into the shared package." },
    { role: "assistant" as const, content: "We should preserve persistent segment reapplication and tool truncation." },
    { role: "user" as const, content: "Make sure the protected tail stays intact." },
    { role: "assistant" as const, content: "I will summarize the older range and keep the recent exchange." },
  ];

  const result = await manageContext({
    messages: input,
    maxTokens: 60,
    compressionThreshold: 0.4,
    protectedTailCount: 1,
    segmentGenerator: {
      async generate({ messages }) {
        return [{
          fromId: messages[0].id,
          toId: messages[messages.length - 1].id,
          compressed: "Summary: migrate compression, preserve persisted segments, keep the protected tail intact.",
        }];
      },
    },
  });

  console.log("rewritten messages:");
  for (const [index, message] of result.messages.entries()) {
    console.log(`  [${index}] ${message.role}/${message.entryType}: ${message.content}`);
  }

  console.log("\nnew segments:");
  console.log(result.newSegments);

  const transcript = createTranscript(result.messages);
  console.log("\ntranscript preview:");
  console.log(transcript.text);
}

main().catch(console.error);
