import { estimateBudgetProfileTokens, normalizeContextBudgetProfile, } from "../../context-budget-profile.js";
import { createDefaultPromptTokenEstimator } from "../../token-estimator.js";
function formatNumber(value) {
    return value.toLocaleString("en-US");
}
function formatPercent(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return 0;
    }
    return Math.round((numerator / denominator) * 100);
}
function buildReminder(options) {
    const { estimatedRequestTokens, estimatedMessageTokens, estimatedToolTokens, rawContextWindow, budgetLabel, budgetDescription, budgetScopedTokens, staticOverheadTokens, workingTokenBudget, } = options;
    const lines = [
        "[Context status]",
        `Current request after context management: ~${formatNumber(estimatedRequestTokens)} tokens.`,
    ];
    if (budgetScopedTokens !== undefined) {
        lines.push(`${budgetLabel ?? "Working budget"} context: ~${formatNumber(budgetScopedTokens)} tokens.`);
    }
    if (staticOverheadTokens !== undefined && staticOverheadTokens > 0) {
        lines.push(`Static overhead outside the ${budgetLabel ?? "working budget"}: ~${formatNumber(staticOverheadTokens)} tokens.`);
    }
    if (estimatedToolTokens > 0) {
        lines.push(`Breakdown: ~${formatNumber(estimatedMessageTokens)} message tokens + ~${formatNumber(estimatedToolTokens)} tool-definition tokens.`);
    }
    if (workingTokenBudget !== undefined) {
        lines.push(`${budgetLabel ?? "Working budget"} target: ~${formatNumber(workingTokenBudget)} tokens (~${formatPercent(budgetScopedTokens ?? estimatedRequestTokens, workingTokenBudget)}% used).`);
    }
    if (budgetDescription) {
        lines.push(budgetDescription);
    }
    if (rawContextWindow !== undefined) {
        lines.push(`Raw model context window: ~${formatNumber(rawContextWindow)} tokens (~${formatPercent(estimatedRequestTokens, rawContextWindow)}% used).`);
    }
    lines.push("[/Context status]");
    return lines.join("\n");
}
export class ContextWindowStatusStrategy {
    name = "context-window-status";
    budgetProfile;
    requestEstimator;
    getContextWindow;
    constructor(options = {}) {
        this.budgetProfile = normalizeContextBudgetProfile(options.budgetProfile);
        this.requestEstimator = options.requestEstimator ?? createDefaultPromptTokenEstimator();
        this.getContextWindow = options.getContextWindow;
    }
    async apply(state) {
        const estimatedMessageTokens = this.requestEstimator.estimatePrompt(state.prompt);
        const estimatedToolTokens = this.requestEstimator.estimateTools?.(state.params?.tools) ?? 0;
        const estimatedRequestTokens = estimatedMessageTokens + estimatedToolTokens;
        const rawContextWindow = this.getContextWindow?.({
            model: state.model,
            requestContext: state.requestContext,
        });
        const budgetScopedTokens = this.budgetProfile
            ? estimateBudgetProfileTokens(this.budgetProfile, state.prompt, state.params?.tools)
            : undefined;
        const staticOverheadTokens = budgetScopedTokens !== undefined
            ? Math.max(0, estimatedRequestTokens - budgetScopedTokens)
            : undefined;
        if (this.budgetProfile === undefined && rawContextWindow === undefined) {
            return {
                outcome: "skipped",
                reason: "no-context-capacity-data",
                payloads: {
                    kind: "context-window-status",
                    estimatedPromptTokens: estimatedRequestTokens,
                    estimatedMessageTokens,
                    estimatedToolTokens,
                },
            };
        }
        const reminderText = buildReminder({
            estimatedRequestTokens,
            estimatedMessageTokens,
            estimatedToolTokens,
            rawContextWindow,
            budgetLabel: this.budgetProfile?.label,
            budgetDescription: this.budgetProfile?.description,
            budgetScopedTokens,
            staticOverheadTokens,
            workingTokenBudget: this.budgetProfile?.tokenBudget,
        });
        await state.emitReminder({
            kind: "context-window-status",
            content: reminderText,
        });
        return {
            reason: "context-window-status-injected",
            ...(this.budgetProfile !== undefined
                ? { workingTokenBudget: this.budgetProfile.tokenBudget }
                : {}),
            payloads: {
                kind: "context-window-status",
                estimatedPromptTokens: estimatedRequestTokens,
                estimatedMessageTokens,
                estimatedToolTokens,
                rawContextWindow,
                rawContextUtilizationPercent: rawContextWindow !== undefined
                    ? formatPercent(estimatedRequestTokens, rawContextWindow)
                    : undefined,
                budgetLabel: this.budgetProfile?.label,
                budgetDescription: this.budgetProfile?.description,
                budgetScopedTokens,
                staticOverheadTokens,
                workingTokenBudget: this.budgetProfile?.tokenBudget,
                workingBudgetUtilizationPercent: this.budgetProfile !== undefined && budgetScopedTokens !== undefined
                    ? formatPercent(budgetScopedTokens, this.budgetProfile.tokenBudget)
                    : undefined,
                reminderText,
            },
        };
    }
}
