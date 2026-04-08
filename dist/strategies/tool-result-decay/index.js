import { clonePrompt, collectToolExchanges } from "../../prompt-utils.js";
import { createDefaultPromptTokenEstimator } from "../../token-estimator.js";
const DEFAULT_MAX_RESULT_TOKENS = 200;
const DEFAULT_PLACEHOLDER_MIN_SOURCE_TOKENS = 800;
const DEFAULT_MIN_PLACEHOLDER_BATCH_SIZE = 10;
const DEFAULT_PLACEHOLDER = "[result omitted]";
const DEFAULT_WARNING_FORECAST_EXTRA_TOKENS = 10_000;
const DEFAULT_MIN_TOTAL_SAVINGS_TOKENS = 0;
const DEFAULT_MIN_DEPTH = 0;
const CHARS_PER_TOKEN = 4;
const DEFAULT_PRESSURE_ANCHORS = [
    { toolTokens: 100, depthFactor: 0.05 },
    { toolTokens: 5_000, depthFactor: 1 },
    { toolTokens: 50_000, depthFactor: 5 },
];
const DEFAULT_SINGLE_TOOL_PRESSURE_ANCHORS = [
    { toolTokens: 50_000, depthFactor: 0.01 }, // < 50k: use global pressure only
    { toolTokens: 100_000, depthFactor: 10 }, // 100k: decay aggressively
    { toolTokens: 500_000, depthFactor: 50 }, // 500k+: decay immediately
];
function safeStringify(value) {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value) ?? "";
    }
    catch {
        return String(value);
    }
}
export function estimateOutputChars(output) {
    switch (output.type) {
        case "text":
        case "error-text":
            return output.value.length;
        case "json":
        case "error-json":
            return safeStringify(output.value).length;
        case "content":
            return output.value.reduce((total, part) => {
                switch (part.type) {
                    case "text":
                        return total + part.text.length;
                    case "file-data":
                    case "image-data":
                        return total + (part.data?.length ?? 0);
                    default:
                        return total + 50;
                }
            }, 0);
        case "execution-denied":
            return (output.reason ?? "").length;
        default:
            return 0;
    }
}
function normalizePressureAnchors(anchors) {
    const source = anchors?.length ? anchors : DEFAULT_PRESSURE_ANCHORS;
    const byToolTokens = new Map();
    for (const anchor of source) {
        const toolTokens = Number.isFinite(anchor.toolTokens) ? Math.max(1, Math.floor(anchor.toolTokens)) : 1;
        const depthFactor = Number.isFinite(anchor.depthFactor) ? Math.max(0.0001, anchor.depthFactor) : 0.0001;
        byToolTokens.set(toolTokens, depthFactor);
    }
    if (byToolTokens.size === 0) {
        return DEFAULT_PRESSURE_ANCHORS.map((anchor) => ({ ...anchor }));
    }
    return [...byToolTokens.entries()]
        .sort(([a], [b]) => a - b)
        .map(([toolTokens, depthFactor]) => ({ toolTokens, depthFactor }));
}
function interpolateDepthFactor(anchors, toolTokens) {
    if (anchors.length === 0) {
        return 1;
    }
    const normalizedTokens = Math.max(0, toolTokens);
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (anchors.length === 1 || normalizedTokens <= first.toolTokens) {
        return first.depthFactor;
    }
    if (normalizedTokens >= last.toolTokens) {
        return last.depthFactor;
    }
    const logTokens = Math.log(Math.max(1, normalizedTokens));
    for (let i = 1; i < anchors.length; i++) {
        const next = anchors[i];
        if (normalizedTokens > next.toolTokens) {
            continue;
        }
        const previous = anchors[i - 1];
        const start = Math.log(previous.toolTokens);
        const end = Math.log(next.toolTokens);
        const progress = end === start ? 1 : (logTokens - start) / (end - start);
        return previous.depthFactor + progress * (next.depthFactor - previous.depthFactor);
    }
    return last.depthFactor;
}
function estimateToolContextTokens(outputCharEstimates, inputCharEstimates) {
    let totalChars = 0;
    for (const value of outputCharEstimates.values()) {
        totalChars += value;
    }
    for (const value of inputCharEstimates.values()) {
        totalChars += value;
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
}
function actionSeverity(action) {
    switch (action.type) {
        case "full":
            return 0;
        case "placeholder":
            return 1;
    }
}
function isForecastWorse(current, forecast) {
    return actionSeverity(forecast) > actionSeverity(current);
}
function classifyExchange(depth, estimatedChars, baseMaxChars, placeholderMinSourceChars, depthFactor) {
    if (depth === 0) {
        return { type: "full" };
    }
    const effectiveDepth = depth * depthFactor;
    if (effectiveDepth < 1) {
        return { type: "full" };
    }
    const maxChars = Math.max(0, Math.floor(baseMaxChars / effectiveDepth));
    if (estimatedChars > maxChars && estimatedChars >= placeholderMinSourceChars) {
        return { type: "placeholder" };
    }
    return { type: "full" };
}
function selectBatchIds(sortedToolCallIds, batchSize, requireFullBatch = true) {
    if (batchSize <= 1) {
        return new Set(sortedToolCallIds);
    }
    if (requireFullBatch && sortedToolCallIds.length < batchSize) {
        return new Set();
    }
    return new Set(sortedToolCallIds.slice(0, batchSize));
}
export class ToolResultDecayStrategy {
    name = "tool-result-decay";
    maxResultTokens;
    placeholderMinSourceTokens;
    minPlaceholderBatchSize;
    placeholder;
    decayInputs;
    estimator;
    pressureAnchors;
    singleToolPressureAnchors;
    warningForecastExtraTokens;
    minTotalSavingsTokens;
    excludeToolNames;
    minDepth;
    constructor(options = {}) {
        this.maxResultTokens = Math.max(0, Math.floor(options.maxResultTokens ?? DEFAULT_MAX_RESULT_TOKENS));
        this.placeholderMinSourceTokens = Math.max(0, Math.floor(options.placeholderMinSourceTokens ?? DEFAULT_PLACEHOLDER_MIN_SOURCE_TOKENS));
        this.minPlaceholderBatchSize = Math.max(1, Math.floor(options.minPlaceholderBatchSize ?? DEFAULT_MIN_PLACEHOLDER_BATCH_SIZE));
        this.placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
        this.decayInputs = options.decayInputs ?? true;
        this.estimator = options.estimator ?? createDefaultPromptTokenEstimator();
        this.pressureAnchors = normalizePressureAnchors(options.pressureAnchors);
        this.singleToolPressureAnchors = normalizePressureAnchors(options.singleToolPressureAnchors ?? DEFAULT_SINGLE_TOOL_PRESSURE_ANCHORS);
        this.warningForecastExtraTokens = Math.max(0, Math.floor(options.warningForecastExtraTokens ?? DEFAULT_WARNING_FORECAST_EXTRA_TOKENS));
        this.minTotalSavingsTokens = Math.max(0, Math.floor(options.minTotalSavingsTokens ?? DEFAULT_MIN_TOTAL_SAVINGS_TOKENS));
        this.excludeToolNames = new Set(options.excludeToolNames ?? []);
        this.minDepth = Math.max(0, Math.floor(options.minDepth ?? DEFAULT_MIN_DEPTH));
    }
    async apply(state) {
        const currentPromptTokens = this.estimator.estimatePrompt(state.prompt)
            + (this.estimator.estimateTools?.(state.params?.tools) ?? 0);
        const exchanges = collectToolExchanges(state.prompt);
        if (exchanges.size === 0) {
            return {
                reason: "no-tool-exchanges",
                payloads: {
                    kind: "tool-result-decay",
                    currentPromptTokens,
                    maxResultTokens: this.maxResultTokens,
                    placeholderMinSourceTokens: this.placeholderMinSourceTokens,
                    minPlaceholderBatchSize: this.minPlaceholderBatchSize,
                    pressureAnchors: this.pressureAnchors.map((anchor) => ({ ...anchor })),
                    singleToolPressureAnchors: this.singleToolPressureAnchors.map((anchor) => ({ ...anchor })),
                    warningForecastExtraTokens: this.warningForecastExtraTokens,
                },
            };
        }
        const turnGroups = new Map();
        for (const exchange of exchanges.values()) {
            const turnKey = exchange.callMessageIndex ?? -1;
            const group = turnGroups.get(turnKey) ?? [];
            group.push(exchange);
            turnGroups.set(turnKey, group);
        }
        const sortedGroups = [...turnGroups.entries()].sort(([a], [b]) => a - b);
        const depthMap = new Map();
        const numGroups = sortedGroups.length;
        for (let groupIdx = 0; groupIdx < numGroups; groupIdx++) {
            const depth = numGroups - 1 - groupIdx;
            for (const exchange of sortedGroups[groupIdx][1]) {
                depthMap.set(exchange.toolCallId, depth);
            }
        }
        const sorted = sortedGroups.flatMap(([, group]) => group);
        const baseMaxChars = this.maxResultTokens * CHARS_PER_TOKEN;
        const placeholderMinSourceChars = this.placeholderMinSourceTokens * CHARS_PER_TOKEN;
        const charEstimates = new Map();
        const originalOutputs = new Map();
        const inputs = new Map();
        const inputCharEstimates = new Map();
        for (const message of state.prompt) {
            if (message.role !== "tool" && message.role !== "assistant") {
                continue;
            }
            for (const part of message.content) {
                if (part.type === "tool-result" && !charEstimates.has(part.toolCallId)) {
                    charEstimates.set(part.toolCallId, estimateOutputChars(part.output));
                    originalOutputs.set(part.toolCallId, part.output);
                }
                if (part.type === "tool-call" && !inputs.has(part.toolCallId)) {
                    inputs.set(part.toolCallId, part.input);
                    inputCharEstimates.set(part.toolCallId, safeStringify(part.input).length);
                }
            }
        }
        const toolContextTokens = estimateToolContextTokens(charEstimates, inputCharEstimates);
        const globalDepthFactor = interpolateDepthFactor(this.pressureAnchors, toolContextTokens);
        const forecastToolContextTokens = toolContextTokens + this.warningForecastExtraTokens;
        const forecastGlobalDepthFactor = interpolateDepthFactor(this.pressureAnchors, forecastToolContextTokens);
        const actions = new Map();
        const placeholderCandidateIds = [];
        for (const exchange of sorted) {
            if (state.pinnedToolCallIds.has(exchange.toolCallId)) {
                actions.set(exchange.toolCallId, { type: "full" });
                continue;
            }
            if (this.excludeToolNames.has(exchange.toolName)) {
                actions.set(exchange.toolCallId, { type: "full" });
                continue;
            }
            const depth = depthMap.get(exchange.toolCallId);
            const estimatedChars = charEstimates.get(exchange.toolCallId) ?? 0;
            const estimatedTokens = Math.ceil(estimatedChars / CHARS_PER_TOKEN);
            const singleToolDepthFactor = interpolateDepthFactor(this.singleToolPressureAnchors, estimatedTokens);
            const effectiveDepthFactor = Math.max(globalDepthFactor, singleToolDepthFactor);
            // Recency protection: don't decay recent tools unless single-tool pressure is very high
            if (depth < this.minDepth && singleToolDepthFactor < 5) {
                actions.set(exchange.toolCallId, { type: "full" });
                continue;
            }
            actions.set(exchange.toolCallId, classifyExchange(depth, estimatedChars, baseMaxChars, placeholderMinSourceChars, effectiveDepthFactor));
            if (actions.get(exchange.toolCallId)?.type === "placeholder") {
                placeholderCandidateIds.push(exchange.toolCallId);
            }
        }
        const placeholderBatchIds = selectBatchIds(placeholderCandidateIds, this.minPlaceholderBatchSize, true);
        const inputActions = new Map();
        const inputPlaceholderCandidateIds = [];
        if (this.decayInputs) {
            for (const exchange of sorted) {
                if (state.pinnedToolCallIds.has(exchange.toolCallId)) {
                    inputActions.set(exchange.toolCallId, { type: "full" });
                    continue;
                }
                if (this.excludeToolNames.has(exchange.toolName)) {
                    inputActions.set(exchange.toolCallId, { type: "full" });
                    continue;
                }
                const depth = depthMap.get(exchange.toolCallId);
                const estimatedChars = inputCharEstimates.get(exchange.toolCallId) ?? 0;
                const estimatedTokens = Math.ceil(estimatedChars / CHARS_PER_TOKEN);
                const singleToolDepthFactor = interpolateDepthFactor(this.singleToolPressureAnchors, estimatedTokens);
                const effectiveDepthFactor = Math.max(globalDepthFactor, singleToolDepthFactor);
                // Recency protection for inputs too
                if (depth < this.minDepth && singleToolDepthFactor < 5) {
                    inputActions.set(exchange.toolCallId, { type: "full" });
                    continue;
                }
                inputActions.set(exchange.toolCallId, classifyExchange(depth, estimatedChars, baseMaxChars, placeholderMinSourceChars, effectiveDepthFactor));
                if (inputActions.get(exchange.toolCallId)?.type === "placeholder") {
                    inputPlaceholderCandidateIds.push(exchange.toolCallId);
                }
            }
        }
        const inputPlaceholderBatchIds = selectBatchIds(inputPlaceholderCandidateIds, this.minPlaceholderBatchSize, true);
        const forecastPlaceholderCandidateIds = [];
        const atRiskExchanges = [];
        for (const exchange of sorted) {
            if (state.pinnedToolCallIds.has(exchange.toolCallId)) {
                continue;
            }
            const depth = depthMap.get(exchange.toolCallId);
            const estimatedChars = charEstimates.get(exchange.toolCallId) ?? 0;
            const estimatedTokens = Math.ceil(estimatedChars / CHARS_PER_TOKEN);
            const forecastSingleToolDepthFactor = interpolateDepthFactor(this.singleToolPressureAnchors, estimatedTokens);
            const forecastEffectiveDepthFactor = Math.max(forecastGlobalDepthFactor, forecastSingleToolDepthFactor);
            const currentAction = actions.get(exchange.toolCallId);
            const forecastAction = classifyExchange(depth + 1, estimatedChars, baseMaxChars, placeholderMinSourceChars, forecastEffectiveDepthFactor);
            if (!isForecastWorse(currentAction, forecastAction)) {
                if (forecastAction.type === "placeholder") {
                    forecastPlaceholderCandidateIds.push(exchange.toolCallId);
                }
                continue;
            }
            if (forecastAction.type === "placeholder") {
                forecastPlaceholderCandidateIds.push(exchange.toolCallId);
            }
            atRiskExchanges.push({
                toolCallId: exchange.toolCallId,
                toolName: exchange.toolName,
                input: inputs.get(exchange.toolCallId),
                output: originalOutputs.get(exchange.toolCallId) ?? { type: "text", value: "" },
                estimatedChars,
                currentAction,
                forecastAction,
            });
        }
        const warningBatchIds = selectBatchIds(forecastPlaceholderCandidateIds, this.minPlaceholderBatchSize, true);
        const warningExchanges = sorted
            .filter((exchange) => warningBatchIds.has(exchange.toolCallId))
            .map((exchange) => {
            const depth = depthMap.get(exchange.toolCallId);
            const estimatedChars = charEstimates.get(exchange.toolCallId) ?? 0;
            const estimatedTokens = Math.ceil(estimatedChars / CHARS_PER_TOKEN);
            const forecastSingleToolDepthFactor = interpolateDepthFactor(this.singleToolPressureAnchors, estimatedTokens);
            const forecastEffectiveDepthFactor = Math.max(forecastGlobalDepthFactor, forecastSingleToolDepthFactor);
            return {
                toolCallId: exchange.toolCallId,
                toolName: exchange.toolName,
                input: inputs.get(exchange.toolCallId),
                output: originalOutputs.get(exchange.toolCallId) ?? { type: "text", value: "" },
                estimatedChars,
                currentAction: actions.get(exchange.toolCallId) ?? { type: "full" },
                forecastAction: classifyExchange(depth + 1, estimatedChars, baseMaxChars, placeholderMinSourceChars, forecastEffectiveDepthFactor),
            };
        });
        const shouldEmitThresholdWarning = placeholderCandidateIds.length < this.minPlaceholderBatchSize
            && forecastPlaceholderCandidateIds.length >= this.minPlaceholderBatchSize
            && warningExchanges.length > 0;
        let placeholderCount = 0;
        let totalSavingsChars = 0;
        for (const toolCallId of placeholderCandidateIds) {
            if (placeholderBatchIds.has(toolCallId)) {
                placeholderCount++;
                const savedChars = charEstimates.get(toolCallId) ?? 0;
                totalSavingsChars += savedChars;
            }
        }
        let inputPlaceholderCount = 0;
        if (this.decayInputs) {
            for (const toolCallId of inputPlaceholderCandidateIds) {
                if (inputPlaceholderBatchIds.has(toolCallId)) {
                    inputPlaceholderCount++;
                    const savedChars = inputCharEstimates.get(toolCallId) ?? 0;
                    totalSavingsChars += savedChars;
                }
            }
        }
        const totalSavingsTokens = Math.ceil(totalSavingsChars / CHARS_PER_TOKEN);
        const meetsMinSavingsThreshold = totalSavingsTokens >= this.minTotalSavingsTokens;
        const warningToolCallIds = warningExchanges.map((entry) => entry.toolCallId);
        const warningPlaceholderIds = warningExchanges.map((entry) => entry.toolCallId);
        const hasMutations = (placeholderCount > 0 || inputPlaceholderCount > 0) && meetsMinSavingsThreshold;
        if (!hasMutations) {
            if (shouldEmitThresholdWarning) {
                await this.emitDecayWarning(state, warningExchanges, forecastToolContextTokens);
            }
            return {
                reason: meetsMinSavingsThreshold ? "tool-results-decayed" : "min-savings-threshold-not-met",
                payloads: {
                    kind: "tool-result-decay",
                    currentPromptTokens,
                    toolContextTokens,
                    depthFactor: globalDepthFactor,
                    forecastToolContextTokens,
                    forecastDepthFactor: forecastGlobalDepthFactor,
                    maxResultTokens: this.maxResultTokens,
                    placeholderMinSourceTokens: this.placeholderMinSourceTokens,
                    minPlaceholderBatchSize: this.minPlaceholderBatchSize,
                    minTotalSavingsTokens: this.minTotalSavingsTokens,
                    totalSavingsTokens,
                    placeholderCount: 0,
                    inputPlaceholderCount: 0,
                    totalToolExchanges: exchanges.size,
                    warningCount: warningExchanges.length,
                    warningForecastExtraTokens: this.warningForecastExtraTokens,
                    warningToolCallIds,
                    warningPlaceholderIds,
                    pressureAnchors: this.pressureAnchors.map((anchor) => ({ ...anchor })),
                    singleToolPressureAnchors: this.singleToolPressureAnchors.map((anchor) => ({ ...anchor })),
                },
            };
        }
        if (shouldEmitThresholdWarning) {
            await this.emitDecayWarning(state, warningExchanges, forecastToolContextTokens);
        }
        const prompt = clonePrompt(state.prompt);
        const removedExchanges = [];
        for (const message of prompt) {
            if (message.role !== "tool" && message.role !== "assistant") {
                continue;
            }
            for (const part of message.content) {
                if (part.type === "tool-result") {
                    const action = actions.get(part.toolCallId);
                    if (!action || action.type === "full" || !placeholderBatchIds.has(part.toolCallId)) {
                        continue;
                    }
                    const placeholderText = typeof this.placeholder === "function"
                        ? this.placeholder({
                            toolName: part.toolName,
                            toolCallId: part.toolCallId,
                            input: inputs.get(part.toolCallId),
                            output: originalOutputs.get(part.toolCallId),
                        })
                        : this.placeholder;
                    part.output = { type: "text", value: placeholderText };
                    removedExchanges.push({
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        reason: "tool-result-decay",
                    });
                }
                if (part.type === "tool-call" && this.decayInputs) {
                    const action = inputActions.get(part.toolCallId);
                    if (!action || action.type === "full" || !inputPlaceholderBatchIds.has(part.toolCallId)) {
                        continue;
                    }
                    part.input = { _omitted: true };
                }
            }
        }
        state.updatePrompt(prompt);
        state.addRemovedToolExchanges(removedExchanges);
        return {
            reason: "tool-results-decayed",
            payloads: {
                kind: "tool-result-decay",
                currentPromptTokens,
                toolContextTokens,
                depthFactor: globalDepthFactor,
                forecastToolContextTokens,
                forecastDepthFactor: forecastGlobalDepthFactor,
                maxResultTokens: this.maxResultTokens,
                placeholderMinSourceTokens: this.placeholderMinSourceTokens,
                minPlaceholderBatchSize: this.minPlaceholderBatchSize,
                minTotalSavingsTokens: this.minTotalSavingsTokens,
                totalSavingsTokens,
                placeholderCount,
                inputPlaceholderCount,
                totalToolExchanges: exchanges.size,
                warningCount: warningExchanges.length,
                warningForecastExtraTokens: this.warningForecastExtraTokens,
                warningToolCallIds,
                warningPlaceholderIds,
                pressureAnchors: this.pressureAnchors.map((anchor) => ({ ...anchor })),
                singleToolPressureAnchors: this.singleToolPressureAnchors.map((anchor) => ({ ...anchor })),
            },
        };
    }
    async emitDecayWarning(state, atRisk, forecastToolContextTokens) {
        const ids = atRisk.map((entry) => entry.toolCallId).join(", ");
        const lines = [
            "Context window under pressure.",
            `Soon some tools you used will be removed from your context. Take notes if you need them: ${ids}`,
        ];
        await state.emitReminder({
            kind: "tool-result-decay-warning",
            content: lines.join("\n"),
            deliveryMode: "stateful",
            attributes: {
                tool_call_ids: atRisk.map((entry) => entry.toolCallId).join(","),
                placeholder_ids: atRisk.map((entry) => entry.toolCallId).join(","),
                forecast_extra_tool_tokens: String(this.warningForecastExtraTokens),
                forecast_tool_context_tokens: String(forecastToolContextTokens),
            },
        });
    }
}
