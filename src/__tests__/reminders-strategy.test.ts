import {
  RemindersStrategy,
  createContextManagementRuntime,
  type ContextManagementStrategy,
  type ReminderProvider,
} from "../index.js";
import { buildContextManagementUserOverlayMessage } from "../prompt-utils.js";
import { makePrompt } from "./helpers.js";

const requestContext = {
  conversationId: "conv-1",
  agentId: "agent-1",
};
const legacyStablePlacement = ["stable", "system"].join("-") as never;

describe("RemindersStrategy", () => {
  test("applies context utilization immediately and context-window status after usage is reported", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          contextUtilization: {
            budgetProfile: {
              tokenBudget: 100,
              estimator: {
                estimateMessage: () => 10,
                estimatePrompt: () => 80,
                estimateTools: () => 0,
              },
            },
            warningThresholdRatio: 0.7,
            mode: "scratchpad",
          },
          contextWindowStatus: {
            getContextWindow: () => 200_000,
          },
        }),
      ],
    });

    const first = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    const firstPromptJson = JSON.stringify(first.messages);
    expect(firstPromptJson).toContain("scratchpad(...) is available for context compaction");
    expect(firstPromptJson).not.toContain("<context-window-status>");

    await first.reportActualUsage(120_000);

    const second = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    expect(JSON.stringify(second.messages)).toContain(
      "Provider-reported last request window: 60% (120,000/200,000 tokens)."
    );
  });

  test("returns overlay runtime messages as a trailing overlay message", async () => {
    const provider: ReminderProvider<{ reminder: string }, string> = {
      type: "todo-list",
      placement: "overlay-user",
      snapshot: async (data) => data?.reminder ?? "",
      renderFull: async (snapshot) =>
        snapshot.length > 0
          ? { type: "todo-list", content: snapshot }
          : null,
      renderDelta: async (previous, current) => previous === current ? null : "full",
    };
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          providers: [provider],
        }),
      ],
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      reminderData: {
        reminder: "Check the pending todo list.",
      },
    });

    expect(prepared.runtimeOverlays).toHaveLength(1);
    expect(prepared.runtimeOverlays?.[0]?.overlayType).toBe("system-reminders");
    expect(prepared.runtimeOverlays?.[0]?.persistInHistory).toBe(true);
    expect(prepared.messages).toHaveLength(makePrompt().length + 1);
    expect(JSON.stringify(prepared.messages.at(-2))).toContain("latest user");
    expect(JSON.stringify(prepared.messages.at(-2))).not.toContain("Check the pending todo list.");
    expect(JSON.stringify(prepared.messages.at(-1))).toContain("Check the pending todo list.");
  });

  test("falls back to an overlay reminder when the latest prompt message is no longer a user turn", async () => {
    const provider: ReminderProvider<{ reminder: string }, string> = {
      type: "todo-list",
      placement: "latest-user-append",
      snapshot: async (data) => data?.reminder ?? "",
      renderFull: async (snapshot) =>
        snapshot.length > 0
          ? { type: "todo-list", content: snapshot }
          : null,
    };
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          providers: [provider],
        }),
      ],
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: [
        ...makePrompt(),
        { role: "assistant", content: [{ type: "text", text: "latest assistant" }] },
      ],
      reminderData: {
        reminder: "Do not rewrite an older user turn.",
      },
    });

    expect(prepared.runtimeOverlays).toHaveLength(1);
    expect(prepared.runtimeOverlays?.[0]?.persistInHistory).toBe(true);
    expect(JSON.stringify(prepared.messages.at(-1))).toContain("Do not rewrite an older user turn.");
    expect(JSON.stringify(prepared.messages)).toContain("latest user");
    expect(JSON.stringify(prepared.messages)).toContain("latest assistant");
    expect(JSON.stringify(prepared.messages)).not.toContain("latest user\\n\\nDo not rewrite an older user turn.");
  });

  test("does not append onto a trailing reminder overlay user message", async () => {
    const provider: ReminderProvider<{ reminder: string }, string> = {
      type: "todo-list",
      placement: "latest-user-append",
      snapshot: async (data) => data?.reminder ?? "",
      renderFull: async (snapshot) =>
        snapshot.length > 0
          ? { type: "todo-list", content: snapshot }
          : null,
    };
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          providers: [provider],
        }),
      ],
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: [
        ...makePrompt(),
        buildContextManagementUserOverlayMessage("Existing overlay reminder."),
      ],
      reminderData: {
        reminder: "Do not chain onto overlay reminders.",
      },
    });

    expect(prepared.runtimeOverlays).toHaveLength(1);
    expect(prepared.runtimeOverlays?.[0]?.persistInHistory).toBe(true);
    expect(JSON.stringify(prepared.messages.at(-1))).toContain("Do not chain onto overlay reminders.");
    expect(JSON.stringify(prepared.messages[prepared.messages.length - 2])).toContain("Existing overlay reminder.");
    expect(JSON.stringify(prepared.messages[prepared.messages.length - 2])).not.toContain("Do not chain onto overlay reminders.");
  });

  test("keeps non-persisted overlay reminders out of persistent runtime overlays", async () => {
    const emittingStrategy: ContextManagementStrategy = {
      name: "emitter",
      apply: async (state) => {
        await state.emitReminder({
          kind: "supervision-correction",
          content: "Fix the last tool call before continuing.",
          placement: "overlay-user",
          persistInHistory: false,
        });
      },
    };
    const runtime = createContextManagementRuntime({
      strategies: [
        emittingStrategy,
        new RemindersStrategy(),
      ],
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
    });

    expect(prepared.messages).toHaveLength(makePrompt().length + 1);
    expect(prepared.runtimeOverlays).toHaveLength(1);
    expect(prepared.runtimeOverlays?.[0]?.persistInHistory).toBe(false);
    expect(JSON.stringify(prepared.messages.at(-1))).toContain("Fix the last tool call before continuing.");
  });

  test("skips unchanged stateful reminders emitted by earlier strategies on later turns", async () => {
    const emittingStrategy: ContextManagementStrategy = {
      name: "emitter",
      apply: async (state) => {
        await state.emitReminder({
          kind: "scratchpad",
          content: "Scratchpad state unchanged.",
        });
      },
    };
    const runtime = createContextManagementRuntime({
      strategies: [
        emittingStrategy,
        new RemindersStrategy(),
      ],
    });

    const first = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
    });
    const second = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
    });

    expect(JSON.stringify(first.messages)).toContain("Scratchpad state unchanged.");
    expect(JSON.stringify(second.messages)).not.toContain("Scratchpad state unchanged.");
  });

  test("skips unchanged built-in reminders on later turns", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          contextWindowStatus: {
            getContextWindow: () => 200_000,
          },
        }),
      ],
    });

    const first = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    await first.reportActualUsage(120_000);

    const second = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });
    await second.reportActualUsage(120_000);

    const third = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    expect(JSON.stringify(first.messages)).not.toContain("<context-window-status>");
    expect(JSON.stringify(second.messages)).toContain("<context-window-status>");
    expect(JSON.stringify(third.messages)).not.toContain("<context-window-status>");
  });

  test("does not emit context-window status below the 50 percent threshold", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          contextWindowStatus: {
            getContextWindow: () => 200,
          },
        }),
      ],
    });

    const first = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    await first.reportActualUsage(90);

    const second = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    expect(JSON.stringify(second.messages)).not.toContain("<context-window-status>");
  });

  test("uses provider-reported input tokens for context-window status", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          contextWindowStatus: {
            getContextWindow: () => 100,
          },
        }),
      ],
    });

    const first = await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: [{ type: "text", text: "12" }] },
      ],
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    await first.reportActualUsage(54);

    const second = await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: [{ type: "text", text: "0" }] },
      ],
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });

    expect(JSON.stringify(first.messages)).not.toContain("<context-window-status>");
    expect(JSON.stringify(second.messages)).toContain(
      "Provider-reported last request window: 54% (54/100 tokens)."
    );
  });

  test("throws when an emitted reminder uses an unsupported placement", async () => {
    const emittingStrategy: ContextManagementStrategy = {
      name: "emitter",
      apply: async (state) => {
        await state.emitReminder({
          kind: "loaded-skills",
          content: "Loaded skills: git, tests",
          placement: legacyStablePlacement,
        });
      },
    };
    const runtime = createContextManagementRuntime({
      strategies: [
        emittingStrategy,
        new RemindersStrategy(),
      ],
    });

    await expect(runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    })).rejects.toThrow(
      new RegExp(`Unsupported reminder placement for emitted reminder "loaded-skills".*${legacyStablePlacement}`)
    );
  });

  test("throws when a placement policy returns an unsupported placement", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new RemindersStrategy({
          contextWindowStatus: {
            getContextWindow: () => 200_000,
          },
          placementPolicy: () => legacyStablePlacement,
        }),
      ],
    });

    const first = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    });
    await first.reportActualUsage(120_000);

    await expect(runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "anthropic",
        modelId: "claude-test",
      },
    })).rejects.toThrow(
      new RegExp(`Unsupported reminder placement for built-in reminder "context-window-status".*${legacyStablePlacement}`)
    );
  });
});
