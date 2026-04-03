import {
  AnthropicPromptCachingStrategy,
  createContextManagementRuntime,
} from "../index.js";

const requestContext = {
  conversationId: "conv-1",
  agentId: "agent-1",
};

describe("AnthropicPromptCachingStrategy", () => {
  test("marks the last naturally shared prefix message instead of the newest volatile message", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new AnthropicPromptCachingStrategy(),
      ],
    });

    await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "Base system prompt." },
        { role: "user", content: [{ type: "text", text: "Repository context: parser.ts and tokenizer.ts." }] },
        { role: "assistant", content: [{ type: "text", text: "I reviewed the shared setup already." }] },
        { role: "user", content: [{ type: "text", text: "Review parser.ts." }] },
      ],
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "Base system prompt." },
        { role: "user", content: [{ type: "text", text: "Repository context: parser.ts and tokenizer.ts." }] },
        { role: "assistant", content: [{ type: "text", text: "I reviewed the shared setup already." }] },
        { role: "user", content: [{ type: "text", text: "Review tokenizer.ts." }] },
      ],
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    expect(prepared.providerOptions).toEqual(
      expect.objectContaining({
        anthropic: expect.objectContaining({
          contextManagement: expect.objectContaining({
            edits: expect.arrayContaining([
              expect.objectContaining({
                type: "clear_tool_uses_20250919",
              }),
            ]),
          }),
        }),
      })
    );

    expect(prepared.messages[2]?.role).toBe("assistant");
    expect(prepared.messages[2]?.providerOptions).toEqual(
      expect.objectContaining({
        anthropic: expect.objectContaining({
          cacheControl: {
            type: "ephemeral",
            ttl: "1h",
          },
        }),
      })
    );
    expect(prepared.messages.at(-1)?.providerOptions).toBeUndefined();
  });
});
