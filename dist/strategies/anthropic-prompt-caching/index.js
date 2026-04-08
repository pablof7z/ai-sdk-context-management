import { clonePrompt } from "../../prompt-utils.js";
import { createSharedPrefixTracker } from "../../prompt-stability-tracker.js";
const ANTHROPIC_CLEAR_TOOL_USES_EDIT = {
    type: "clear_tool_uses_20250919",
    trigger: { type: "tool_uses", value: 25 },
    keep: { type: "tool_uses", value: 10 },
    clearAtLeast: { type: "input_tokens", value: 4000 },
    clearToolInputs: true,
    excludeTools: ["delegate", "delegate_followup", "delegate_crossproject"],
};
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeInteger(value, fallback, minimum) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(minimum, Math.floor(value))
        : fallback;
}
function normalizeToolList(value, fallback) {
    if (!Array.isArray(value)) {
        return [...fallback];
    }
    const normalized = value
        .flatMap((entry) => (typeof entry === "string" ? [entry.trim()] : []))
        .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}
function normalizeAnthropicServerToolEditing(options) {
    const rawServerToolEditing = options.serverToolEditing;
    const rawConfig = isRecord(rawServerToolEditing) ? rawServerToolEditing : {};
    let enabled = options.clearToolUses !== false;
    if (rawServerToolEditing === false) {
        enabled = false;
    }
    else if (rawServerToolEditing === true) {
        enabled = true;
    }
    else if (typeof rawConfig.enabled === "boolean") {
        enabled = rawConfig.enabled;
    }
    return {
        enabled,
        triggerToolUses: normalizeInteger(rawConfig.triggerToolUses, ANTHROPIC_CLEAR_TOOL_USES_EDIT.trigger.value, 1),
        keepToolUses: normalizeInteger(rawConfig.keepToolUses, ANTHROPIC_CLEAR_TOOL_USES_EDIT.keep.value, 0),
        clearAtLeastInputTokens: normalizeInteger(rawConfig.clearAtLeastInputTokens, ANTHROPIC_CLEAR_TOOL_USES_EDIT.clearAtLeast.value, 0),
        clearToolInputs: typeof rawConfig.clearToolInputs === "boolean"
            ? rawConfig.clearToolInputs
            : ANTHROPIC_CLEAR_TOOL_USES_EDIT.clearToolInputs,
        excludeTools: normalizeToolList(rawConfig.excludeTools, ANTHROPIC_CLEAR_TOOL_USES_EDIT.excludeTools),
    };
}
function buildAnthropicClearToolUsesEdit(serverToolEditing) {
    return {
        type: ANTHROPIC_CLEAR_TOOL_USES_EDIT.type,
        trigger: { type: "tool_uses", value: serverToolEditing.triggerToolUses },
        keep: { type: "tool_uses", value: serverToolEditing.keepToolUses },
        clearAtLeast: {
            type: "input_tokens",
            value: serverToolEditing.clearAtLeastInputTokens,
        },
        clearToolInputs: serverToolEditing.clearToolInputs,
        excludeTools: serverToolEditing.excludeTools,
    };
}
function withAnthropicClearToolUses(providerOptions, serverToolEditing) {
    const normalizedProviderOptions = isRecord(providerOptions) ? providerOptions : {};
    const anthropicOptions = isRecord(normalizedProviderOptions.anthropic)
        ? normalizedProviderOptions.anthropic
        : {};
    const contextManagement = isRecord(anthropicOptions.contextManagement)
        ? anthropicOptions.contextManagement
        : {};
    const existingEdits = Array.isArray(contextManagement.edits)
        ? contextManagement.edits
        : [];
    const clearToolUsesEdit = buildAnthropicClearToolUsesEdit(serverToolEditing);
    const hasClearToolUses = existingEdits.some((edit) => isRecord(edit) && edit.type === clearToolUsesEdit.type);
    return {
        ...normalizedProviderOptions,
        anthropic: {
            ...anthropicOptions,
            contextManagement: {
                ...contextManagement,
                edits: hasClearToolUses
                    ? existingEdits
                    : [...existingEdits, clearToolUsesEdit],
            },
        },
    };
}
function withAnthropicSharedPrefixBreakpoint(prompt, lastSharedMessageIndex, ttl) {
    if (lastSharedMessageIndex === undefined) {
        return prompt;
    }
    const cloned = clonePrompt(prompt);
    const target = cloned[lastSharedMessageIndex];
    if (!target) {
        return prompt;
    }
    const anthropicOptions = isRecord(target.providerOptions?.anthropic)
        ? target.providerOptions?.anthropic
        : {};
    target.providerOptions = {
        ...(target.providerOptions ?? {}),
        anthropic: {
            ...anthropicOptions,
            cacheControl: { type: "ephemeral", ttl },
        },
    };
    return cloned;
}
function isEligibleSharedPrefixMessage(message) {
    if (message.role === "system" || message.role === "user") {
        return true;
    }
    if (message.role === "tool") {
        return false;
    }
    return !message.content.some((part) => part.type === "tool-call" || part.type === "tool-result");
}
function resolveEligibleSharedPrefixBreakpoint(prompt, lastSharedMessageIndex) {
    if (lastSharedMessageIndex === undefined) {
        return undefined;
    }
    for (let index = lastSharedMessageIndex; index >= 0; index -= 1) {
        const message = prompt[index];
        if (message && isEligibleSharedPrefixMessage(message)) {
            return index;
        }
    }
    return undefined;
}
export class AnthropicPromptCachingStrategy {
    name = "anthropic-prompt-caching";
    ttl;
    serverToolEditing;
    tracker = createSharedPrefixTracker();
    constructor(options = {}) {
        this.ttl = options.ttl ?? "1h";
        this.serverToolEditing = normalizeAnthropicServerToolEditing(options);
    }
    apply(state) {
        if (state.model?.provider !== "anthropic") {
            return {
                outcome: "skipped",
                reason: "non-anthropic-provider",
                payloads: {
                    kind: "anthropic-prompt-caching",
                    sharedPrefixMessageCount: 0,
                    breakpointApplied: false,
                    clearToolUsesEnabled: false,
                },
            };
        }
        if (this.serverToolEditing.enabled) {
            state.updateParams({
                providerOptions: withAnthropicClearToolUses(state.params.providerOptions, this.serverToolEditing),
            });
        }
        const observation = this.tracker.observe(state.prompt);
        const lastEligibleSharedMessageIndex = resolveEligibleSharedPrefixBreakpoint(state.prompt, observation.lastSharedMessageIndex);
        const sharedPrefixMessageCount = lastEligibleSharedMessageIndex === undefined
            ? 0
            : lastEligibleSharedMessageIndex + 1;
        const hasSharedPrefix = sharedPrefixMessageCount > 0;
        state.updatePrompt(withAnthropicSharedPrefixBreakpoint(state.prompt, lastEligibleSharedMessageIndex, this.ttl));
        return {
            outcome: observation.hasSharedPrefix || this.serverToolEditing.enabled ? "applied" : "skipped",
            reason: observation.hasSharedPrefix
                ? "shared-prefix-breakpoint-applied"
                : this.serverToolEditing.enabled
                    ? "clear-tool-uses-enabled"
                    : "no-shared-prefix",
            payloads: {
                kind: "anthropic-prompt-caching",
                sharedPrefixMessageCount: observation.sharedPrefixMessageCount,
                lastSharedMessageIndex: observation.lastSharedMessageIndex,
                breakpointApplied: observation.hasSharedPrefix,
                clearToolUsesEnabled: this.serverToolEditing.enabled,
            },
        };
    }
}
