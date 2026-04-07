import { clonePrompt } from "./prompt-utils.js";
import { createCalibratingEstimator, createDefaultPromptTokenEstimator } from "./token-estimator.js";
import { CONTEXT_MANAGEMENT_KEY } from "./types.js";
class StrategyState {
    requestContext;
    model;
    lastReportedModelInputTokens;
    currentParams;
    removedByToolCallId = new Map();
    pinned = new Set();
    queuedReminders = [];
    runtimeOverlays = [];
    constructor(params, requestContext, model, lastReportedModelInputTokens) {
        this.requestContext = requestContext;
        this.model = model;
        this.lastReportedModelInputTokens = lastReportedModelInputTokens;
        this.currentParams = {
            ...params,
            prompt: clonePrompt(params.prompt),
        };
        if (params.queuedReminders) {
            this.queuedReminders.push(...params.queuedReminders.map((reminder) => normalizeReminder(reminder, "transient")));
        }
    }
    get params() {
        return this.currentParams;
    }
    get prompt() {
        return this.currentParams.prompt;
    }
    get reminderData() {
        return this.currentParams.reminderData;
    }
    get removedToolExchanges() {
        return Array.from(this.removedByToolCallId.values());
    }
    get pinnedToolCallIds() {
        return this.pinned;
    }
    get preparedRuntimeOverlays() {
        return this.runtimeOverlays;
    }
    updatePrompt(prompt) {
        this.currentParams = {
            ...this.currentParams,
            prompt,
        };
    }
    updateParams(patch) {
        this.currentParams = {
            ...this.currentParams,
            ...patch,
            prompt: patch.prompt ?? this.currentParams.prompt,
        };
    }
    addRemovedToolExchanges(exchanges) {
        for (const exchange of exchanges) {
            this.removedByToolCallId.set(exchange.toolCallId, exchange);
        }
    }
    addPinnedToolCallIds(toolCallIds) {
        for (const id of toolCallIds) {
            this.pinned.add(id);
        }
    }
    addRuntimeOverlay(overlay) {
        this.runtimeOverlays.push(cloneUnknown(overlay));
    }
    consumeReminderQueue() {
        const queued = this.queuedReminders.map((reminder) => cloneUnknown(reminder));
        this.queuedReminders.length = 0;
        return queued;
    }
    async emitReminder(reminder) {
        this.queuedReminders.push(normalizeReminder(reminder, "stateful"));
    }
}
function normalizeReminder(reminder, defaultDeliveryMode) {
    const cloned = cloneUnknown(reminder);
    return {
        ...cloned,
        deliveryMode: cloned.deliveryMode ?? defaultDeliveryMode,
    };
}
function cloneUnknown(value) {
    if (value === undefined || value === null) {
        return value;
    }
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        }
        catch {
            return value;
        }
    }
    return value;
}
function countMessages(prompt) {
    return prompt.length;
}
function usageStoreKey(requestContext) {
    return `${requestContext.conversationId}:${requestContext.agentId}`;
}
function normalizeStrategyPayload(strategyName, payload) {
    if (!payload || typeof payload !== "object" || payload === null) {
        return undefined;
    }
    const candidate = payload;
    if (typeof candidate.kind === "string") {
        return cloneUnknown(payload);
    }
    return {
        kind: "custom",
        strategyName,
        payload: cloneUnknown(candidate),
    };
}
function extractRequestContextFromExperimentalContext(experimentalContext) {
    if (!experimentalContext ||
        typeof experimentalContext !== "object" ||
        !(CONTEXT_MANAGEMENT_KEY in experimentalContext)) {
        return null;
    }
    const raw = experimentalContext[CONTEXT_MANAGEMENT_KEY];
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const conversationId = raw.conversationId;
    const agentId = raw.agentId;
    const agentLabel = raw.agentLabel;
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
async function emitTelemetry(telemetry, buildEvent) {
    if (!telemetry) {
        return;
    }
    try {
        await telemetry(buildEvent());
    }
    catch {
        // Telemetry is best-effort and must never break model or tool execution.
    }
}
function mergeOptionalTools(strategies) {
    const merged = {};
    const toolOwners = new Map();
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
function wrapOptionalTools(tools, toolOwners, telemetry) {
    const wrapped = {};
    for (const [toolName, toolDefinition] of Object.entries(tools)) {
        const strategyName = toolOwners.get(toolName);
        const execute = toolDefinition.execute;
        if (!execute) {
            wrapped[toolName] = toolDefinition;
            continue;
        }
        wrapped[toolName] = {
            ...toolDefinition,
            execute: async (input, options) => {
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
                }
                catch (error) {
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
function createActualUsageReporter(options) {
    return async (actualInputTokens) => {
        if (actualInputTokens == null || actualInputTokens <= 0) {
            return;
        }
        options.usageByRequestContext.set(usageStoreKey(options.requestContext), actualInputTokens);
        const rawEstimate = options.baseEstimator.estimatePrompt(options.prompt) +
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
export function createContextManagementRuntime(options) {
    const strategies = [...options.strategies];
    const baseEstimator = options.estimator ?? createDefaultPromptTokenEstimator();
    const calibratingEstimator = createCalibratingEstimator(baseEstimator);
    const estimator = calibratingEstimator;
    const { tools, toolOwners } = mergeOptionalTools(strategies);
    const optionalTools = wrapOptionalTools(tools, toolOwners, options.telemetry);
    const usageByRequestContext = new Map();
    return {
        async prepareRequest({ requestContext, messages, tools: requestTools, toolChoice, providerOptions, model, reminderData, queuedReminders, }) {
            const state = new StrategyState({
                prompt: clonePrompt(messages),
                tools: requestTools,
                toolChoice,
                providerOptions: cloneUnknown(providerOptions),
                reminderData: cloneUnknown(reminderData),
                queuedReminders: queuedReminders?.map((reminder) => cloneUnknown(reminder)),
            }, requestContext, model, usageByRequestContext.get(usageStoreKey(requestContext)));
            const estimate = (prompt, tools) => estimator.estimatePrompt(prompt) + (estimator.estimateTools?.(tools) ?? 0);
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
                const execution = await strategy.apply(state);
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
                    strategyPayload: normalizeStrategyPayload(strategy.name ?? "unnamed-strategy", execution?.payloads),
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
                messages: clonePrompt(state.prompt),
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
