import { ContextWindowStatusStrategy, createContextManagementRuntime } from "../index.js";
import type { ContextManagementTelemetryEvent } from "../index.js";
import { makePrompt } from "./helpers.js";

describe("ContextWindowStatusStrategy", () => {
  test("injects request status using working budget and raw model window", async () => {
    const events: ContextManagementTelemetryEvent[] = [];
    const runtime = createContextManagementRuntime({
      strategies: [
        new ContextWindowStatusStrategy({
          budgetProfile: {
            tokenBudget: 400,
            label: "managed working budget",
            description: "This excludes base system prompts, tool definitions, and reminder blocks.",
            estimator: {
              estimateMessage: () => 10,
              estimatePrompt: () => 80,
              estimateTools: () => 0,
            },
          },
          requestEstimator: {
            estimateMessage: () => 10,
            estimatePrompt: () => 120,
            estimateTools: () => 30,
          },
          getContextWindow: ({ model }) =>
            model?.provider === "openrouter" && model.modelId === "anthropic/claude-4"
              ? 200_000
              : undefined,
        }),
      ],
      telemetry: async (event) => {
        events.push(event);
      },
      estimator: {
        estimateMessage: () => 10,
        estimatePrompt: () => 120,
        estimateTools: () => 30,
      },
    });

    const transformed = await runtime.prepareRequest({
      requestContext: {
        conversationId: "conv-1",
        agentId: "agent-1",
      },
      messages: makePrompt(),
      model: {
        provider: "openrouter",
        modelId: "anthropic/claude-4",
      },
    });

    const promptJson = JSON.stringify(transformed.messages);
    expect(promptJson).toContain("managed working budget: 20% (~80/400 tokens).");
    expect(promptJson).toContain("Model window: 0% (~150/200,000 tokens).");

    const strategyEvent = events.find((event) => event.type === "strategy-complete");
    expect(strategyEvent).toBeDefined();
    if (strategyEvent?.type === "strategy-complete") {
      expect(strategyEvent.reason).toBe("context-window-status-injected");
      expect(strategyEvent.strategyPayload).toEqual(
        expect.objectContaining({
          kind: "context-window-status",
          estimatedPromptTokens: 150,
          estimatedMessageTokens: 120,
          estimatedToolTokens: 30,
          budgetScopedTokens: 80,
          staticOverheadTokens: 70,
          rawContextWindow: 200_000,
          workingTokenBudget: 400,
          reminderText: expect.stringContaining("managed working budget: 20%"),
        })
      );
    }
  });

  test("skips when neither working budget nor raw context window is available", async () => {
    const strategy = new ContextWindowStatusStrategy({
      requestEstimator: {
        estimateMessage: () => 10,
        estimatePrompt: () => 120,
        estimateTools: () => 30,
      },
    });
    const prompt = makePrompt();
    const state = {
      params: { prompt, providerOptions: {} },
      prompt,
      requestContext: { conversationId: "conv-1", agentId: "agent-1" },
      removedToolExchanges: [],
      pinnedToolCallIds: new Set<string>(),
      updatePrompt(nextPrompt: typeof prompt) {
        this.prompt = nextPrompt;
      },
      updateParams() {},
      addRemovedToolExchanges() {},
      addPinnedToolCallIds() {},
      emitReminder() {
        throw new Error("unused");
      },
    } as any;

    const result = await strategy.apply(state);

    expect(result).toEqual({
      outcome: "skipped",
      reason: "no-context-capacity-data",
      payloads: {
        kind: "context-window-status",
        estimatedPromptTokens: 150,
        estimatedMessageTokens: 120,
        estimatedToolTokens: 30,
      },
    });
  });
});
