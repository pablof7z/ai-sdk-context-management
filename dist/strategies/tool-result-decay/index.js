import { clonePrompt, collectToolExchanges } from "../../prompt-utils.js";
import { createDefaultPromptTokenEstimator } from "../../token-estimator.js";
const DEFAULT_MAX_RESULT_TOKENS = 200;
const DEFAULT_PLACEHOLDER_MIN_SOURCE_TOKENS = 800;
const DEFAULT_PLACEHOLDER = "[result omitted]";
const DEFAULT_WARNING_FORECAST_EXTRA_TOKENS = 10_000;
const CHARS_PER_TOKEN = 4;
const DEFAULT_PRESSURE_ANCHORS = [
    { toolTokens: 100, depthFactor: 0.05 },
    { toolTokens: 5_000, depthFactor: 1 },
    { toolTokens: 50_000, depthFactor: 5 },
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
export class ToolResultDecayStrategy {
    name = "tool-result-decay";
    maxResultTokens;
    placeholderMinSourceTokens;
    placeholder;
    decayInputs;
    estimator;
    pressureAnchors;
    warningForecastExtraTokens;
    constructor(options = {}) {
        this.maxResultTokens = Math.max(0, Math.floor(options.maxResultTokens ?? DEFAULT_MAX_RESULT_TOKENS));
        this.placeholderMinSourceTokens = Math.max(0, Math.floor(options.placeholderMinSourceTokens ?? DEFAULT_PLACEHOLDER_MIN_SOURCE_TOKENS));
        this.placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
        this.decayInputs = options.decayInputs ?? true;
        this.estimator = options.estimator ?? createDefaultPromptTokenEstimator();
        this.pressureAnchors = normalizePressureAnchors(options.pressureAnchors);
        this.warningForecastExtraTokens = Math.max(0, Math.floor(options.warningForecastExtraTokens ?? DEFAULT_WARNING_FORECAST_EXTRA_TOKENS));
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
                    pressureAnchors: this.pressureAnchors.map((anchor) => ({ ...anchor })),
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
        const depthFactor = interpolateDepthFactor(this.pressureAnchors, toolContextTokens);
        const forecastToolContextTokens = toolContextTokens + this.warningForecastExtraTokens;
        const forecastDepthFactor = interpolateDepthFactor(this.pressureAnchors, forecastToolContextTokens);
        const actions = new Map();
        for (const exchange of sorted) {
            if (state.pinnedToolCallIds.has(exchange.toolCallId)) {
                actions.set(exchange.toolCallId, { type: "full" });
                continue;
            }
            const depth = depthMap.get(exchange.toolCallId);
            const estimatedChars = charEstimates.get(exchange.toolCallId) ?? 0;
            actions.set(exchange.toolCallId, classifyExchange(depth, estimatedChars, baseMaxChars, placeholderMinSourceChars, depthFactor));
        }
        const inputActions = new Map();
        if (this.decayInputs) {
            for (const exchange of sorted) {
                if (state.pinnedToolCallIds.has(exchange.toolCallId)) {
                    inputActions.set(exchange.toolCallId, { type: "full" });
                    continue;
                }
                const depth = depthMap.get(exchange.toolCallId);
                const estimatedChars = inputCharEstimates.get(exchange.toolCallId) ?? 0;
                inputActions.set(exchange.toolCallId, classifyExchange(depth, estimatedChars, baseMaxChars, placeholderMinSourceChars, depthFactor));
            }
        }
        const atRiskExchanges = [];
        for (const exchange of sorted) {
            if (state.pinnedToolCallIds.has(exchange.toolCallId)) {
                continue;
            }
            const depth = depthMap.get(exchange.toolCallId);
            const estimatedChars = charEstimates.get(exchange.toolCallId) ?? 0;
            const currentAction = actions.get(exchange.toolCallId);
            const forecastAction = classifyExchange(depth + 1, estimatedChars, baseMaxChars, placeholderMinSourceChars, forecastDepthFactor);
            if (!isForecastWorse(currentAction, forecastAction)) {
                continue;
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
        let placeholderCount = 0;
        for (const action of actions.values()) {
            if (action.type === "placeholder") {
                placeholderCount++;
            }
        }
        let inputPlaceholderCount = 0;
        if (this.decayInputs) {
            for (const action of inputActions.values()) {
                if (action.type === "placeholder") {
                    inputPlaceholderCount++;
                }
            }
        }
        const warningToolCallIds = atRiskExchanges.map((entry) => entry.toolCallId);
        const warningPlaceholderIds = atRiskExchanges.map((entry) => entry.toolCallId);
        const hasMutations = placeholderCount > 0 || inputPlaceholderCount > 0;
        if (!hasMutations) {
            if (atRiskExchanges.length > 0) {
                await this.emitDecayWarning(state, atRiskExchanges, forecastToolContextTokens);
            }
            return {
                reason: "tool-results-decayed",
                payloads: {
                    kind: "tool-result-decay",
                    currentPromptTokens,
                    toolContextTokens,
                    depthFactor,
                    forecastToolContextTokens,
                    forecastDepthFactor,
                    maxResultTokens: this.maxResultTokens,
                    placeholderMinSourceTokens: this.placeholderMinSourceTokens,
                    placeholderCount: 0,
                    inputPlaceholderCount: 0,
                    totalToolExchanges: exchanges.size,
                    warningCount: atRiskExchanges.length,
                    warningForecastExtraTokens: this.warningForecastExtraTokens,
                    warningToolCallIds,
                    warningPlaceholderIds,
                    pressureAnchors: this.pressureAnchors.map((anchor) => ({ ...anchor })),
                },
            };
        }
        if (atRiskExchanges.length > 0) {
            await this.emitDecayWarning(state, atRiskExchanges, forecastToolContextTokens);
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
                    if (!action || action.type === "full") {
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
                    if (!action || action.type === "full") {
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
                depthFactor,
                forecastToolContextTokens,
                forecastDepthFactor,
                maxResultTokens: this.maxResultTokens,
                placeholderMinSourceTokens: this.placeholderMinSourceTokens,
                placeholderCount,
                inputPlaceholderCount,
                totalToolExchanges: exchanges.size,
                warningCount: atRiskExchanges.length,
                warningForecastExtraTokens: this.warningForecastExtraTokens,
                warningToolCallIds,
                warningPlaceholderIds,
                pressureAnchors: this.pressureAnchors.map((anchor) => ({ ...anchor })),
            },
        };
    }
    async emitDecayWarning(state, atRisk, forecastToolContextTokens) {
        const lines = [
            `Context decay notice: If the next step adds about ${this.warningForecastExtraTokens.toLocaleString("en-US")} tool-context tokens (to roughly ${forecastToolContextTokens.toLocaleString("en-US")} total tool-context tokens), the following tool results will be replaced with placeholders.`,
            "Save or restate anything important now.",
        ];
        for (const entry of atRisk) {
            const estimatedTokens = Math.ceil(entry.estimatedChars / CHARS_PER_TOKEN);
            if (typeof this.placeholder === "function") {
                const formatted = this.placeholder({
                    toolName: entry.toolName,
                    toolCallId: entry.toolCallId,
                    input: entry.input,
                    output: entry.output,
                });
                lines.push(`- ${formatted} (~${estimatedTokens.toLocaleString("en-US")} tokens)`);
                continue;
            }
            lines.push(`- ${entry.toolCallId} (${entry.toolName}): ~${estimatedTokens.toLocaleString("en-US")} tokens -> placeholder`);
        }
        await state.emitReminder({
            kind: "tool-result-decay-warning",
            content: lines.join("\n"),
            attributes: {
                tool_call_ids: atRisk.map((entry) => entry.toolCallId).join(","),
                placeholder_ids: atRisk.map((entry) => entry.toolCallId).join(","),
                forecast_extra_tool_tokens: String(this.warningForecastExtraTokens),
                forecast_tool_context_tokens: String(forecastToolContextTokens),
            },
        });
    }
}
