import { clonePrompt } from "../../prompt-utils.js";
import { createSharedPrefixTracker } from "../../prompt-stability-tracker.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
    tracker = createSharedPrefixTracker();
    constructor(options = {}) {
        this.ttl = options.ttl ?? "1h";
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
                },
            };
        }
        const observation = this.tracker.observe(state.prompt);
        const lastEligibleSharedMessageIndex = resolveEligibleSharedPrefixBreakpoint(state.prompt, observation.lastSharedMessageIndex);
        const sharedPrefixMessageCount = lastEligibleSharedMessageIndex === undefined
            ? 0
            : lastEligibleSharedMessageIndex + 1;
        const hasSharedPrefix = sharedPrefixMessageCount > 0;
        state.updatePrompt(withAnthropicSharedPrefixBreakpoint(state.prompt, lastEligibleSharedMessageIndex, this.ttl));
        return {
            outcome: hasSharedPrefix ? "applied" : "skipped",
            reason: hasSharedPrefix
                ? "shared-prefix-breakpoint-applied"
                : "no-shared-prefix",
            payloads: {
                kind: "anthropic-prompt-caching",
                sharedPrefixMessageCount,
                lastSharedMessageIndex: lastEligibleSharedMessageIndex,
                breakpointApplied: hasSharedPrefix,
            },
        };
    }
}
