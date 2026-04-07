import {
  AnthropicPromptCachingStrategy,
  createContextManagementRuntime,
  ToolResultDecayStrategy,
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

  test("backtracks over trailing tool exchanges to the last stable conversational message", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new AnthropicPromptCachingStrategy({
          clearToolUses: false,
        }),
      ],
    });

    await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "Base system prompt." },
        { role: "user", content: [{ type: "text", text: "Repository context." }] },
        { role: "assistant", content: [{ type: "text", text: "I inspected the code already." }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-1", toolName: "fs_read", input: { path: "parser.ts" } }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-1", toolName: "fs_read", output: { type: "text", value: "parser contents" } }],
        },
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
        { role: "user", content: [{ type: "text", text: "Repository context." }] },
        { role: "assistant", content: [{ type: "text", text: "I inspected the code already." }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-1", toolName: "fs_read", input: { path: "parser.ts" } }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-1", toolName: "fs_read", output: { type: "text", value: "parser contents" } }],
        },
        { role: "user", content: [{ type: "text", text: "Now review tokenizer.ts." }] },
      ],
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

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
    expect(prepared.messages[3]?.providerOptions).toBeUndefined();
    expect(prepared.messages[4]?.providerOptions).toBeUndefined();
  });

  test("backtracks over tool-call tails when decay rewrites the following tool result on the next request", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new ToolResultDecayStrategy({
          maxResultTokens: 10,
          placeholderMinSourceTokens: 1,
          pressureAnchors: [
            { toolTokens: 1, depthFactor: 1 },
            { toolTokens: 5_000, depthFactor: 1 },
            { toolTokens: 50_000, depthFactor: 1 },
          ],
          warningForecastExtraTokens: 0,
        }),
        new AnthropicPromptCachingStrategy({
          clearToolUses: false,
        }),
      ],
    });

    await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "Base system prompt." },
        { role: "user", content: [{ type: "text", text: "Inspect the previous failure." }] },
        { role: "assistant", content: [{ type: "text", text: "I checked the previous output already." }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-old", toolName: "read_log", input: { path: "old.log" } }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-old", toolName: "read_log", output: { type: "text", value: "x".repeat(2000) } }],
        },
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
        { role: "user", content: [{ type: "text", text: "Inspect the previous failure." }] },
        { role: "assistant", content: [{ type: "text", text: "I checked the previous output already." }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-old", toolName: "read_log", input: { path: "old.log" } }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-old", toolName: "read_log", output: { type: "text", value: "x".repeat(2000) } }],
        },
        { role: "user", content: [{ type: "text", text: "Compare it with the latest failure." }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-new", toolName: "read_log", input: { path: "new.log" } }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-new", toolName: "read_log", output: { type: "text", value: "recent" } }],
        },
      ],
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

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
    expect(prepared.messages[3]?.providerOptions).toBeUndefined();

    const decayedToolMessage = prepared.messages[4] as {
      role?: string;
      content?: Array<{ type?: string; output?: { type?: string; value?: string } }>;
    };
    expect(decayedToolMessage.role).toBe("tool");
    expect(decayedToolMessage.content?.[0]?.type).toBe("tool-result");
    expect(decayedToolMessage.content?.[0]?.output).toEqual({
      type: "text",
      value: "[result omitted]",
    });
  });
});
