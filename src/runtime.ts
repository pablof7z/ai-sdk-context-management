import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { ModelMessage, ToolSet } from "ai";
import { clonePrompt } from "./prompt-utils.js";
import { createCalibratingEstimator, createDefaultPromptTokenEstimator } from "./token-estimator.js";
import { CONTEXT_MANAGEMENT_KEY } from "./types.js";
import type {
  ContextManagementReminder,
  ContextManagementPreparedRequest,
  ContextManagementStrategyPayload,
  ContextManagementModelRef,
  ContextManagementRequestParams,
  ContextManagementRequestContext,
  ContextManagementRuntime,
  ContextManagementStrategy,
  ContextManagementStrategyExecution,
  ContextManagementStrategyState,
  ContextManagementTelemetrySink,
  CreateContextManagementRuntimeOptions,
  PrepareContextManagementRequestOptions,
  PromptTokenEstimator,
  ReminderRuntimeOverlay,
  RemovedToolExchange,
} from "./types.js";

class StrategyState implements ContextManagementStrategyState {
  private currentParams: ContextManagementRequestParams;
  private readonly removedByToolCallId = new Map<string, RemovedToolExchange>();
  private readonly pinned = new Set<string>();
  private readonly queuedReminders: ContextManagementReminder[] = [];
  private readonly runtimeOverlays: ReminderRuntimeOverlay[] = [];

  constructor(
    params: ContextManagementRequestParams,
    public readonly requestContext: ContextManagementRequestContext,
    public readonly model?: ContextManagementModelRef,
    public readonly lastReportedModelInputTokens?: number
    ) {
    this.currentParams = {
      ...params,
      prompt: clonePrompt(params.prompt),
    };
    if (params.queuedReminders) {
      this.queuedReminders.push(
        ...params.queuedReminders.map((reminder) =>
          normalizeReminder(reminder, "transient")
        )
      );
    }
  }

  get params(): ContextManagementRequestParams {
    return this.currentParams;
  }

  get prompt() {
    return this.currentParams.prompt;
  }

  get reminderData() {
    return this.currentParams.reminderData;
  }

  get removedToolExchanges(): readonly RemovedToolExchange[] {
    return Array.from(this.removedByToolCallId.values());
  }

  get pinnedToolCallIds(): ReadonlySet<string> {
    return this.pinned;
  }

  get preparedRuntimeOverlays(): readonly ReminderRuntimeOverlay[] {
    return this.runtimeOverlays;
  }

  updatePrompt(prompt: ContextManagementRequestParams["prompt"]): void {
    this.currentParams = {
      ...this.currentParams,
      prompt,
    };
  }

  updateParams(patch: Partial<ContextManagementRequestParams>): void {
    this.currentParams = {
      ...this.currentParams,
      ...patch,
      prompt: patch.prompt ?? this.currentParams.prompt,
    };
  }

  addRemovedToolExchanges(exchanges: RemovedToolExchange[]): void {
    for (const exchange of exchanges) {
      this.removedByToolCallId.set(exchange.toolCallId, exchange);
    }
  }

  addPinnedToolCallIds(toolCallIds: string[]): void {
    for (const id of toolCallIds) {
      this.pinned.add(id);
    }
  }

  addRuntimeOverlay(overlay: ReminderRuntimeOverlay): void {
    this.runtimeOverlays.push(cloneUnknown(overlay));
  }

  consumeReminderQueue(): ContextManagementReminder[] {
    const queued = this.queuedReminders.map((reminder) => cloneUnknown(reminder));
    this.queuedReminders.length = 0;
    return queued;
  }

  async emitReminder(reminder: ContextManagementReminder): Promise<void> {
    this.queuedReminders.push(normalizeReminder(reminder, "stateful"));
  }
}

function normalizeReminder(
  reminder: ContextManagementReminder,
  defaultDeliveryMode: ContextManagementReminder["deliveryMode"]
): ContextManagementReminder {
  const cloned = cloneUnknown(reminder);
  return {
    ...cloned,
    deliveryMode: cloned.deliveryMode ?? defaultDeliveryMode,
  };
}

function cloneUnknown<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }

  return value;
}

function countMessages(prompt: ContextManagementRequestParams["prompt"]): number {
  return prompt.length;
}

function usageStoreKey(requestContext: ContextManagementRequestContext): string {
  return `${requestContext.conversationId}:${requestContext.agentId}`;
}

function normalizeStrategyPayload(
  strategyName: string,
  payload: ContextManagementStrategyExecution["payloads"]
): ContextManagementStrategyPayload | undefined {
  if (!payload || typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.kind === "string") {
    return cloneUnknown(payload) as ContextManagementStrategyPayload;
  }

  return {
    kind: "custom",
    strategyName,
    payload: cloneUnknown(candidate),
  };
}

function extractRequestContextFromExperimentalContext(
  experimentalContext: unknown
): ContextManagementRequestContext | null {
  if (
    !experimentalContext ||
    typeof experimentalContext !== "object" ||
    !(CONTEXT_MANAGEMENT_KEY in experimentalContext)
  ) {
    return null;
  }

  const raw = (experimentalContext as Record<string, unknown>)[CONTEXT_MANAGEMENT_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const conversationId = (raw as Record<string, unknown>).conversationId;
  const agentId = (raw as Record<string, unknown>).agentId;
  const agentLabel = (raw as Record<string, unknown>).agentLabel;

  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  if (typeof agentId !== "string" || agentId.length === 0) {
    return null;
  }

  return {
    conversationId,
    agentId,
    ...(typeof agentLabel === "string" && agentLabel.length > 0 ? { agentLabel } : {}),
  };
}

async function emitTelemetry(
  telemetry: ContextManagementTelemetrySink | undefined,
  buildEvent: () => Parameters<ContextManagementTelemetrySink>[0]
): Promise<void> {
  if (!telemetry) {
    return;
  }

  try {
    await telemetry(buildEvent());
  } catch {
    // Telemetry is best-effort and must never break model or tool execution.
  }
}

function mergeOptionalTools(strategies: readonly ContextManagementStrategy[]): {
  tools: ToolSet;
  toolOwners: Map<string, string>;
} {
  const merged = {} as ToolSet;
  const toolOwners = new Map<string, string>();

  for (const strategy of strategies) {
    const tools = strategy.getOptionalTools?.();
    if (!tools) {
      continue;
    }

    for (const [toolName, toolDefinition] of Object.entries(tools)) {
      if (toolName in merged) {
        throw new Error(`Duplicate context-management tool name: ${toolName}`);
      }

      merged[toolName] = toolDefinition;
      toolOwners.set(toolName, strategy.name ?? "unnamed-strategy");
    }
  }

  return {
    tools: merged,
    toolOwners,
  };
}

function wrapOptionalTools(
  tools: ToolSet,
  toolOwners: Map<string, string>,
  telemetry: ContextManagementTelemetrySink | undefined
): ToolSet {
  const wrapped = {} as ToolSet;

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const strategyName = toolOwners.get(toolName);
    const execute = (toolDefinition as { execute?: (...args: unknown[]) => unknown }).execute;

    if (!execute) {
      wrapped[toolName] = toolDefinition;
      continue;
    }

    wrapped[toolName] = {
      ...toolDefinition,
      execute: async (input: unknown, options: { toolCallId?: string; experimental_context?: unknown }) => {
        const requestContext = extractRequestContextFromExperimentalContext(options.experimental_context);
        await emitTelemetry(telemetry, () => ({
          type: "tool-execute-start",
          toolName,
          strategyName,
          toolCallId: options.toolCallId,
          requestContext,
          payloads: {
            input: cloneUnknown(input),
          },
        }));

        try {
          const result = await execute(input, options);
          await emitTelemetry(telemetry, () => ({
            type: "tool-execute-complete",
            toolName,
            strategyName,
            toolCallId: options.toolCallId,
            requestContext,
            payloads: {
              input: cloneUnknown(input),
              result: cloneUnknown(result),
            },
          }));
          return result;
        } catch (error) {
          await emitTelemetry(telemetry, () => ({
            type: "tool-execute-error",
            toolName,
            strategyName,
            toolCallId: options.toolCallId,
            requestContext,
            payloads: {
              input: cloneUnknown(input),
              error: cloneUnknown(error),
            },
          }));
          throw error;
        }
      },
    };
  }

  return wrapped;
}

function createActualUsageReporter(options: {
  baseEstimator: PromptTokenEstimator;
  calibratingEstimator: ReturnType<typeof createCalibratingEstimator>;
  telemetry: ContextManagementTelemetrySink | undefined;
  requestContext: ContextManagementRequestContext;
  prompt: LanguageModelV3Prompt;
  tools: ToolSet | undefined;
  usageByRequestContext: Map<string, number>;
}): ContextManagementPreparedRequest["reportActualUsage"] {
  return async (actualInputTokens) => {
    if (actualInputTokens == null || actualInputTokens <= 0) {
      return;
    }

    options.usageByRequestContext.set(
      usageStoreKey(options.requestContext),
      actualInputTokens
    );

    const rawEstimate =
      options.baseEstimator.estimatePrompt(options.prompt) +
      (options.baseEstimator.estimateTools?.(options.tools) ?? 0);

    if (rawEstimate <= 0) {
      return;
    }

    const previousFactor = options.calibratingEstimator.calibrationFactor;
    options.calibratingEstimator.reportActualUsage(rawEstimate, actualInputTokens);

    await emitTelemetry(options.telemetry, () => ({
      type: "calibration-update",
      requestContext: options.requestContext,
      rawEstimate,
      actualTokens: actualInputTokens,
      previousFactor,
      newFactor: options.calibratingEstimator.calibrationFactor,
      sampleCount: options.calibratingEstimator.calibrationSamples,
    }));
  };
}

export function createContextManagementRuntime(
  options: CreateContextManagementRuntimeOptions
): ContextManagementRuntime {
  const strategies = [...options.strategies];
  const baseEstimator: PromptTokenEstimator = options.estimator ?? createDefaultPromptTokenEstimator();
  const calibratingEstimator = createCalibratingEstimator(baseEstimator);
  const estimator = calibratingEstimator;
  const { tools, toolOwners } = mergeOptionalTools(strategies);
  const optionalTools = wrapOptionalTools(tools, toolOwners, options.telemetry);
  const usageByRequestContext = new Map<string, number>();

  return {
    async prepareRequest({
      requestContext,
      messages,
      tools: requestTools,
      toolChoice,
      providerOptions,
      model,
      reminderData,
      queuedReminders,
    }: PrepareContextManagementRequestOptions): Promise<ContextManagementPreparedRequest> {
      const state = new StrategyState(
        {
          prompt: clonePrompt(messages as LanguageModelV3Prompt),
          tools: requestTools,
          toolChoice,
          providerOptions: cloneUnknown(providerOptions),
          reminderData: cloneUnknown(reminderData),
          queuedReminders: queuedReminders?.map((reminder) => cloneUnknown(reminder)),
        },
        requestContext,
        model,
        usageByRequestContext.get(usageStoreKey(requestContext))
      );
      const estimate = (prompt: LanguageModelV3Prompt, tools: ToolSet | undefined) =>
        estimator.estimatePrompt(prompt) + (estimator.estimateTools?.(tools) ?? 0);
      const initialTokenEstimate = estimate(state.prompt, state.params.tools);
      const initialMessageCount = countMessages(state.prompt);

      await emitTelemetry(options.telemetry, () => ({
        type: "runtime-start",
        requestContext,
        strategyNames: strategies.map((strategy) => strategy.name ?? "unnamed-strategy"),
        optionalToolNames: Object.keys(optionalTools),
        estimatedTokensBefore: initialTokenEstimate,
        messageCount: initialMessageCount,
        payloads: {
          providerOptions: cloneUnknown(providerOptions),
        },
      }));

      for (const strategy of strategies) {
        const removedBefore = state.removedToolExchanges.length;
        const pinnedBefore = state.pinnedToolCallIds.size;
        const messageCountBefore = countMessages(state.prompt);
        const estimatedTokensBefore = estimate(state.prompt, state.params.tools);
        const execution: ContextManagementStrategyExecution | void = await strategy.apply(state);
        const estimatedTokensAfter = estimate(state.prompt, state.params.tools);
        const messageCountAfter = countMessages(state.prompt);
        const removedAfter = state.removedToolExchanges.length;
        const pinnedAfter = state.pinnedToolCallIds.size;
        const changed = estimatedTokensBefore !== estimatedTokensAfter
          || messageCountBefore !== messageCountAfter
          || removedAfter !== removedBefore
          || pinnedAfter !== pinnedBefore;

        await emitTelemetry(options.telemetry, () => ({
          type: "strategy-complete",
          requestContext,
          strategyName: strategy.name ?? "unnamed-strategy",
          outcome: execution?.outcome ?? (changed ? "applied" : "skipped"),
          reason: execution?.reason ?? (changed ? "state-changed" : "no-op"),
          estimatedTokensBefore,
          estimatedTokensAfter,
          workingTokenBudget: execution?.workingTokenBudget,
          removedToolExchangesDelta: removedAfter - removedBefore,
          removedToolExchangesTotal: removedAfter,
          pinnedToolCallIdsDelta: pinnedAfter - pinnedBefore,
          messageCountBefore,
          messageCountAfter,
          strategyPayload: normalizeStrategyPayload(
            strategy.name ?? "unnamed-strategy",
            execution?.payloads
          ),
        }));
      }

      await emitTelemetry(options.telemetry, () => ({
        type: "runtime-complete",
        requestContext,
        estimatedTokensBefore: initialTokenEstimate,
        estimatedTokensAfter: estimate(state.prompt, state.params.tools),
        removedToolExchangesTotal: state.removedToolExchanges.length,
        pinnedToolCallIdsTotal: state.pinnedToolCallIds.size,
        messageCountBefore: initialMessageCount,
        messageCountAfter: countMessages(state.prompt),
        payloads: {
          prompt: clonePrompt(state.prompt),
          providerOptions: cloneUnknown(state.params.providerOptions),
          ...(state.params.toolChoice !== undefined
            ? { toolChoice: cloneUnknown(state.params.toolChoice) }
            : {}),
        },
      }));

      return {
        messages: clonePrompt(state.prompt) as ModelMessage[],
        providerOptions: cloneUnknown(state.params.providerOptions),
        toolChoice: cloneUnknown(state.params.toolChoice),
        ...(state.preparedRuntimeOverlays.length > 0
          ? {
            runtimeOverlays: state.preparedRuntimeOverlays.map((overlay) => cloneUnknown(overlay)),
          }
          : {}),
        reportActualUsage: createActualUsageReporter({
          baseEstimator,
          calibratingEstimator,
          telemetry: options.telemetry,
          requestContext,
          prompt: clonePrompt(state.prompt),
          tools: state.params.tools,
          usageByRequestContext,
        }),
      };
    },
    optionalTools,
  };
}
