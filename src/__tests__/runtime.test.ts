import type { ContextManagementTelemetryEvent } from "../index.js";
import {
  ContextUtilizationReminderStrategy,
  ScratchpadStrategy,
  SlidingWindowStrategy,
  createContextManagementRuntime,
} from "../index.js";
import { InMemoryScratchpadStore, makePrompt } from "./helpers.js";

const requestContext = {
  conversationId: "conv-1",
  agentId: "agent-1",
  agentLabel: "Alpha",
};

describe("createContextManagementRuntime", () => {
  test("returns prepareRequest plus merged optional tools", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new SlidingWindowStrategy({ keepLastMessages: 2 }),
        new ScratchpadStrategy({ scratchpadStore: new InMemoryScratchpadStore() }),
      ],
    });

    expect(typeof runtime.prepareRequest).toBe("function");
    expect(Object.keys(runtime.optionalTools)).toEqual(["scratchpad"]);
  });

  test("no-ops when strategies do not mutate the request", async () => {
    const prompt = makePrompt();
    const runtime = createContextManagementRuntime({
      strategies: [],
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: prompt,
      providerOptions: {
        custom: {
          debug: true,
        },
      },
    });

    expect(prepared.messages).toEqual(prompt);
    expect(prepared.providerOptions).toEqual({
      custom: {
        debug: true,
      },
    });
    expect(prepared.toolChoice).toBeUndefined();
  });

  test("emits runtime and strategy telemetry with final prompt payloads", async () => {
    const events: ContextManagementTelemetryEvent[] = [];
    const runtime = createContextManagementRuntime({
      strategies: [new SlidingWindowStrategy({ keepLastMessages: 2 })],
      telemetry: async (event) => {
        events.push(event);
      },
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
      model: {
        provider: "mock",
        modelId: "mock",
      },
    });

    expect(prepared.messages.map((message) => message.role)).toEqual([
      "system",
      "assistant",
      "tool",
      "user",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "runtime-start",
      "strategy-complete",
      "runtime-complete",
    ]);

    const completeEvent = events[2];
    expect(completeEvent?.type).toBe("runtime-complete");
    if (completeEvent?.type === "runtime-complete") {
      expect(completeEvent.requestContext).toEqual(requestContext);
      expect(completeEvent.payloads.prompt).toEqual(prepared.messages);
      expect(completeEvent.payloads.providerOptions).toBeUndefined();
      expect(completeEvent.payloads.toolChoice).toBeUndefined();
    }
  });

  test("scratchpad can force toolChoice through prepareRequest", async () => {
    const runtime = createContextManagementRuntime({
      strategies: [
        new ScratchpadStrategy({
          scratchpadStore: new InMemoryScratchpadStore(),
          budgetProfile: {
            tokenBudget: 100,
            estimator: {
              estimateMessage: () => 40,
              estimatePrompt: () => 80,
              estimateTools: () => 0,
            },
          },
          forceToolThresholdRatio: 0.7,
        }),
      ],
      estimator: {
        estimateMessage: () => 40,
        estimatePrompt: () => 80,
        estimateTools: () => 0,
      },
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: [
        { role: "system", content: "You are helpful." },
        {
          role: "user",
          content: [{ type: "text", text: "Long request that needs compaction." }],
        },
      ],
      tools: runtime.optionalTools,
    });

    expect(prepared.toolChoice).toEqual({
      type: "tool",
      toolName: "scratchpad",
    });
  });

  test("wraps optional tools with telemetry for execute lifecycle", async () => {
    const events: ContextManagementTelemetryEvent[] = [];
    const runtime = createContextManagementRuntime({
      strategies: [new ScratchpadStrategy({ scratchpadStore: new InMemoryScratchpadStore() })],
      telemetry: async (event) => {
        events.push(event);
      },
    });

    await runtime.optionalTools.scratchpad.execute?.(
      {
        description: "Track parser cleanup",
        setEntries: {
          notes: "Track parser cleanup",
        },
      },
      {
        toolCallId: "scratchpad-call-1",
        experimental_context: {
          contextManagement: requestContext,
        },
      }
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool-execute-start",
      "tool-execute-complete",
    ]);
  });

  test("reportActualUsage emits calibration telemetry", async () => {
    const events: ContextManagementTelemetryEvent[] = [];
    const runtime = createContextManagementRuntime({
      strategies: [
        new ContextUtilizationReminderStrategy({
          budgetProfile: {
            tokenBudget: 100,
            estimator: {
              estimateMessage: () => 10,
              estimatePrompt: () => 100,
              estimateTools: () => 0,
            },
          },
          warningThresholdRatio: 0.7,
        }),
      ],
      telemetry: async (event) => {
        events.push(event);
      },
      estimator: {
        estimateMessage: () => 10,
        estimatePrompt: () => 100,
        estimateTools: () => 0,
      },
    });

    const prepared = await runtime.prepareRequest({
      requestContext,
      messages: makePrompt(),
    });

    await prepared.reportActualUsage(150);

    const calibrationEvent = events.find((event) => event.type === "calibration-update");
    expect(calibrationEvent?.type).toBe("calibration-update");
    if (calibrationEvent?.type === "calibration-update") {
      expect(calibrationEvent.requestContext).toEqual(requestContext);
      expect(calibrationEvent.rawEstimate).toBe(100);
      expect(calibrationEvent.actualTokens).toBe(150);
      expect(calibrationEvent.newFactor).toBeGreaterThan(1);
      expect(calibrationEvent.sampleCount).toBe(1);
    }
  });
});
