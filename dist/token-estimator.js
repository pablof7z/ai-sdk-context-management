import { asSchema } from "ai";
const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
function estimateString(text) {
    if (text.length === 0) {
        return 0;
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}
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
function isPromiseLike(value) {
    return typeof value === "object" && value !== null && "then" in value;
}
function estimateToolResultOutput(output) {
    if (output.type === "text") {
        return estimateString(output.value);
    }
    return estimateString(safeStringify(output));
}
export function createDefaultPromptTokenEstimator() {
    return {
        estimateMessage(message) {
            if (message.role === "system") {
                return MESSAGE_OVERHEAD_TOKENS + estimateString(message.content);
            }
            let total = MESSAGE_OVERHEAD_TOKENS;
            for (const part of message.content) {
                switch (part.type) {
                    case "text":
                    case "reasoning":
                        total += estimateString(part.text) + 1;
                        break;
                    case "file":
                        total += estimateString(part.filename ?? "");
                        total += estimateString(part.mediaType);
                        total += 16;
                        break;
                    case "tool-call":
                        total += estimateString(part.toolName);
                        total += estimateString(safeStringify(part.input));
                        total += 6;
                        break;
                    case "tool-result":
                        total += estimateString(part.toolName);
                        total += estimateToolResultOutput(part.output);
                        total += 6;
                        break;
                    case "tool-approval-response":
                        total += 8;
                        break;
                }
            }
            return total;
        },
        estimatePrompt(prompt) {
            return prompt.reduce((sum, message) => sum + this.estimateMessage(message), 0);
        },
        estimateTools(tools) {
            if (!tools || Object.keys(tools).length === 0) {
                return 0;
            }
            let total = 0;
            for (const [name, tool] of Object.entries(tools)) {
                if (tool.type === "provider") {
                    total += estimateString(safeStringify(tool));
                    continue;
                }
                const schema = asSchema(tool.inputSchema).jsonSchema;
                const inputSchema = isPromiseLike(schema) ? "[async-json-schema]" : schema;
                total += estimateString(name);
                total += estimateString(tool.description ?? "");
                total += estimateString(safeStringify(inputSchema));
                total += estimateString(safeStringify(tool.inputExamples));
                total += estimateString(safeStringify(tool.providerOptions));
                total += 6;
            }
            return total;
        },
    };
}
export function createCalibratingEstimator(base, options) {
    const inner = base ?? createDefaultPromptTokenEstimator();
    const alpha = options?.alpha ?? 0.3;
    let factor = 1.0;
    let samples = 0;
    function calibrate(raw) {
        return Math.ceil(raw * factor);
    }
    return {
        get calibrationFactor() {
            return factor;
        },
        get calibrationSamples() {
            return samples;
        },
        estimateMessage(message) {
            return calibrate(inner.estimateMessage(message));
        },
        estimatePrompt(prompt) {
            return calibrate(inner.estimatePrompt(prompt));
        },
        estimateTools(tools) {
            return calibrate(inner.estimateTools?.(tools) ?? 0);
        },
        reportActualUsage(rawEstimate, actualTokens) {
            if (actualTokens <= 0 || rawEstimate <= 0)
                return;
            samples++;
            const idealFactor = actualTokens / rawEstimate;
            if (samples <= 2) {
                factor += (idealFactor - factor) / samples;
            }
            else {
                factor = alpha * idealFactor + (1 - alpha) * factor;
            }
            factor = Math.max(0.5, Math.min(3.0, factor));
        },
    };
}
