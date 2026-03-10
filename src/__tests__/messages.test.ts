import { describe, test, expect } from "bun:test";
import type { ContextCompressionMessage } from "../types.js";
import { contextMessagesToMessages, messagesToContextMessages, normalizeMessages } from "../messages.js";

describe("normalizeMessages", () => {
  test("fails when a message id is missing", () => {
    expect(() => normalizeMessages([
      { id: "msg-1", role: "user", content: "hello" },
      { role: "user", content: "hello" },
    ])).toThrow('messages[1].id must be a non-empty string');
  });

  test("fails when message ids are duplicated", () => {
    expect(() => normalizeMessages([
      { id: "msg-1", role: "user", content: "hello" },
      { id: "msg-1", role: "assistant", content: "hi" },
    ])).toThrow('Duplicate message id "msg-1"');
  });
});

describe("messagesToContextMessages", () => {
  test("accepts plain string user and assistant message content", () => {
    const messages: ContextCompressionMessage[] = [
      { id: "evt-user-1", role: "user", content: "hello" },
      { id: "evt-assistant-1", role: "assistant", content: "hi" },
    ];

    const contextMessages = messagesToContextMessages(messages);

    expect(contextMessages).toEqual([
      { id: "evt-user-1", role: "user", content: "hello", entryType: "text", metadata: expect.any(Object) },
      { id: "evt-assistant-1", role: "assistant", content: "hi", entryType: "text", metadata: expect.any(Object) },
    ]);
  });

  test("preserves stable message ids instead of deriving them from tool call ids", () => {
    const messages: ContextCompressionMessage[] = [
      {
        id: "evt-tool-call-1",
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "search", input: { q: "x" } }],
      },
      {
        id: "evt-tool-result-1",
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "search",
          output: { type: "text", value: "result" },
        }],
      },
    ];

    const contextMessages = messagesToContextMessages(messages);

    expect(contextMessages[0].id).toBe("evt-tool-call-1");
    expect(contextMessages[0].toolCallId).toBe("call-1");
    expect(contextMessages[1].id).toBe("evt-tool-result-1");
    expect(contextMessages[1].toolCallId).toBe("call-1");
  });
});

describe("contextMessagesToMessages", () => {
  test("preserves plain string text messages when they are rewritten", () => {
    const messages: ContextCompressionMessage[] = [
      { id: "evt-user-1", role: "user", content: "hello" },
    ];

    const contextMessages = messagesToContextMessages(messages);
    contextMessages[0] = {
      ...contextMessages[0],
      content: "rewritten",
    };

    const rebuiltMessages = contextMessagesToMessages(contextMessages);

    expect(rebuiltMessages).toEqual([
      { id: "evt-user-1", role: "user", content: "rewritten", providerOptions: undefined },
    ]);
  });

  test("rebuilds modified tool calls as AI SDK tool-call messages", () => {
    const messages: ContextCompressionMessage[] = [
      {
        id: "evt-tool-call-1",
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "fs_write", input: { path: "/tmp/file", content: "abc" } }],
      },
    ];

    const contextMessages = messagesToContextMessages(messages);
    contextMessages[0] = {
      ...contextMessages[0],
      content: "[Tool call input removed for brevity]",
    };

    const rebuiltMessages = contextMessagesToMessages(contextMessages);
    const toolCallMessage = rebuiltMessages[0];

    expect(toolCallMessage.id).toBe("evt-tool-call-1");
    expect(toolCallMessage.role).toBe("assistant");
    expect((toolCallMessage.content[0] as any).type).toBe("tool-call");
    expect((toolCallMessage.content[0] as any).input).toEqual({
      _contextCompressionInput: "[Tool call input removed for brevity]",
    });
  });

  test("rebuilds modified tool results as AI SDK tool messages", () => {
    const messages: ContextCompressionMessage[] = [
      {
        id: "evt-tool-call-1",
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "search", input: { q: "x" } }],
      },
      {
        id: "evt-tool-result-1",
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "search",
          output: { type: "text", value: "original" },
        }],
      },
    ];

    const contextMessages = messagesToContextMessages(messages);
    contextMessages[1] = {
      ...contextMessages[1],
      content: "truncated",
    };

    const rebuiltMessages = contextMessagesToMessages(contextMessages);
    const toolMessage = rebuiltMessages[1];

    expect(toolMessage.id).toBe("evt-tool-result-1");
    expect(toolMessage.role).toBe("tool");
    expect((toolMessage.content[0] as any).output).toEqual({ type: "text", value: "truncated" });
  });
});
