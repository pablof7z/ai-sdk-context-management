import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { SummarizationStrategy } from "../summarization-strategy.js";
import type {
  ContextManagementStrategyState,
  RemovedToolExchange,
} from "../types.js";

const estimator = {
  estimateMessage: () => 100,
  estimatePrompt: (prompt: LanguageModelV3Prompt) => prompt.length * 100,
};

function createMockState(prompt: LanguageModelV3Prompt): ContextManagementStrategyState & {
  capturedRemovedExchanges: RemovedToolExchange[];
} {
  const capturedRemovedExchanges: RemovedToolExchange[] = [];

  return {
    params: {
      prompt,
      providerOptions: {
        contextManagement: {
          conversationId: "conv-1",
          agentId: "agent-1",
        },
      },
    } as any,
    prompt,
    requestContext: { conversationId: "conv-1", agentId: "agent-1" },
    removedToolExchanges: [],
    pinnedToolCallIds: new Set(),
    capturedRemovedExchanges,
    updatePrompt(newPrompt: LanguageModelV3Prompt) {
      (this as any).prompt = newPrompt;
    },
    addRemovedToolExchanges(exchanges: RemovedToolExchange[]) {
      capturedRemovedExchanges.push(...exchanges);
    },
    addPinnedToolCallIds() {},
  };
}

function makeSummarize() {
  const calls: LanguageModelV3Message[][] = [];
  const fn = async (messages: LanguageModelV3Message[]) => {
    calls.push(messages);
    return `summary of ${messages.length} messages`;
  };
  return { fn, calls };
}

describe("SummarizationStrategy", () => {
  test("no-op when under token threshold", async () => {
    const { fn: summarize, calls } = makeSummarize();
    const strategy = new SummarizationStrategy({
      summarize,
      maxPromptTokens: 1000,
      estimator,
    });

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];

    const state = createMockState(prompt);
    await strategy.apply(state);

    expect(calls).toHaveLength(0);
    // Prompt unchanged (same references since updatePrompt was never called)
    expect(state.prompt).toEqual(prompt);
  });

  test("summarizes older messages when over threshold", async () => {
    const { fn: summarize, calls } = makeSummarize();
    const strategy = new SummarizationStrategy({
      summarize,
      maxPromptTokens: 200,
      keepLastMessages: 2,
      estimator,
    });

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: [{ type: "text", text: "old message 1" }] },
      { role: "assistant", content: [{ type: "text", text: "old reply 1" }] },
      { role: "user", content: [{ type: "text", text: "old message 2" }] },
      { role: "assistant", content: [{ type: "text", text: "old reply 2" }] },
      { role: "user", content: [{ type: "text", text: "recent question" }] },
      { role: "assistant", content: [{ type: "text", text: "recent answer" }] },
    ];

    const state = createMockState(prompt);
    await strategy.apply(state);

    expect(calls).toHaveLength(1);
    // 6 non-system messages total, keepLastMessages=2, so 4 messages summarized
    expect(calls[0]).toHaveLength(4);

    // Result: system + summary + 2 tail messages
    expect(state.prompt).toHaveLength(4);
    expect(state.prompt[0].role).toBe("system");
    expect(state.prompt[0].content).toBe("You are helpful.");
    expect(state.prompt[1].role).toBe("system");
    expect(state.prompt[1].content).toBe("summary of 4 messages");
    expect(state.prompt[2].role).toBe("user");
    expect(state.prompt[3].role).toBe("assistant");
  });

  test("keeps tail messages intact", async () => {
    const { fn: summarize } = makeSummarize();
    const strategy = new SummarizationStrategy({
      summarize,
      maxPromptTokens: 200,
      keepLastMessages: 2,
      estimator,
    });

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "system" },
      { role: "user", content: [{ type: "text", text: "old" }] },
      { role: "assistant", content: [{ type: "text", text: "old reply" }] },
      { role: "user", content: [{ type: "text", text: "recent user msg" }] },
      { role: "assistant", content: [{ type: "text", text: "recent assistant msg" }] },
    ];

    const state = createMockState(prompt);
    await strategy.apply(state);

    // Tail messages should be the last 2 non-system messages
    const tailMessages = state.prompt.filter(m => m.role !== "system");
    expect(tailMessages).toHaveLength(2);

    const userMsg = tailMessages[0] as Extract<LanguageModelV3Message, { role: "user" }>;
    expect(userMsg.content[0]).toEqual({ type: "text", text: "recent user msg" });

    const assistantMsg = tailMessages[1] as Extract<LanguageModelV3Message, { role: "assistant" }>;
    expect(assistantMsg.content[0]).toEqual({ type: "text", text: "recent assistant msg" });
  });

  test("includes previous summary in next summarization pass", async () => {
    const { fn: summarize, calls } = makeSummarize();
    const strategy = new SummarizationStrategy({
      summarize,
      maxPromptTokens: 200,
      keepLastMessages: 1,
      estimator,
    });

    const previousSummary: LanguageModelV3Message = {
      role: "system",
      content: "previous summary text",
      providerOptions: { contextManagement: { type: "summary" } },
    };

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "You are helpful." },
      previousSummary,
      { role: "user", content: [{ type: "text", text: "msg 1" }] },
      { role: "assistant", content: [{ type: "text", text: "reply 1" }] },
      { role: "user", content: [{ type: "text", text: "msg 2" }] },
    ];

    const state = createMockState(prompt);
    await strategy.apply(state);

    expect(calls).toHaveLength(1);
    // Should include the previous summary + 2 summarizable non-system messages
    expect(calls[0]).toHaveLength(3);
    expect(calls[0][0]).toBe(previousSummary);

    // The old summary system message should be removed and replaced with the new one
    const summaryMessages = state.prompt.filter(
      (m) => m.role === "system" && m.providerOptions?.contextManagement
    );
    expect(summaryMessages).toHaveLength(1);
    expect(summaryMessages[0].content).toBe("summary of 3 messages");

    // The original system message should still be there
    const regularSystemMessages = state.prompt.filter(
      (m) => m.role === "system" && !m.providerOptions?.contextManagement
    );
    expect(regularSystemMessages).toHaveLength(1);
    expect(regularSystemMessages[0].content).toBe("You are helpful.");
  });

  test("reports removed tool exchanges", async () => {
    const { fn: summarize } = makeSummarize();
    const strategy = new SummarizationStrategy({
      summarize,
      maxPromptTokens: 200,
      keepLastMessages: 1,
      estimator,
    });

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "system" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: { path: "a.ts" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-1", toolName: "read_file", output: { type: "text", value: "contents" } },
        ],
      },
      { role: "user", content: [{ type: "text", text: "latest" }] },
    ];

    const state = createMockState(prompt);
    await strategy.apply(state);

    expect(state.capturedRemovedExchanges).toHaveLength(1);
    expect(state.capturedRemovedExchanges[0]).toEqual({
      toolCallId: "call-1",
      toolName: "read_file",
      reason: "summarization",
    });
  });

  test("summary message is tagged with providerOptions", async () => {
    const { fn: summarize } = makeSummarize();
    const strategy = new SummarizationStrategy({
      summarize,
      maxPromptTokens: 200,
      keepLastMessages: 1,
      estimator,
    });

    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "system" },
      { role: "user", content: [{ type: "text", text: "old" }] },
      { role: "assistant", content: [{ type: "text", text: "old reply" }] },
      { role: "user", content: [{ type: "text", text: "latest" }] },
    ];

    const state = createMockState(prompt);
    await strategy.apply(state);

    const summaryMessage = state.prompt.find(
      (m) =>
        m.role === "system" &&
        m.providerOptions?.contextManagement &&
        (m.providerOptions.contextManagement as Record<string, unknown>).type === "summary"
    );

    expect(summaryMessage).toBeDefined();
    expect(summaryMessage!.role).toBe("system");
    expect(summaryMessage!.providerOptions).toEqual({
      contextManagement: { type: "summary" },
    });
  });
});
