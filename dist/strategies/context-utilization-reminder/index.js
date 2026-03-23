import { estimateBudgetProfileTokens, normalizeContextBudgetProfile, } from "../../context-budget-profile.js";
const DEFAULT_WARNING_THRESHOLD_RATIO = 0.7;
function buildReminder(options) {
    const { currentTokens, warningThresholdTokens, utilizationPercent, mode, budgetLabel, budgetDescription, } = options;
    const lines = [
        `[Context utilization: ~${utilizationPercent}% of ${budgetLabel}]`,
        `Current ${budgetLabel} tokens: ~${currentTokens}. Warning threshold: ~${warningThresholdTokens}.`,
    ];
    if (budgetDescription) {
        lines.push(budgetDescription);
    }
    if (mode === "scratchpad") {
        lines.push(`Your ${budgetLabel} is getting tight. Use scratchpad(...) now to:`);
        lines.push("- Rewrite your current working state so it reflects what matters now");
        lines.push("- Capture user requirements, constraints, and completion state");
        lines.push("- Omit stale tool call IDs you no longer need");
        lines.push("- Reduce preserveTurns if the preserved head/tail turns are larger than necessary");
        lines.push("- If a preserved request could look unresolved later, keep its satisfying turn or record clearly that it is already done and must not be repeated");
    }
    else {
        lines.push(`Your ${budgetLabel} is getting tight. Trim or summarize stale context before continuing.`);
    }
    lines.push("[/Context utilization]");
    return lines.join("\n");
}
export class ContextUtilizationReminderStrategy {
    name = "context-utilization-reminder";
    budgetProfile;
    warningThresholdRatio;
    mode;
    constructor(options) {
        this.budgetProfile = normalizeContextBudgetProfile(options.budgetProfile);
        this.warningThresholdRatio = Math.min(1, Math.max(0, options.warningThresholdRatio ?? DEFAULT_WARNING_THRESHOLD_RATIO));
        this.mode = options.mode ?? "generic";
    }
    async apply(state) {
        const currentTokens = estimateBudgetProfileTokens(this.budgetProfile, state.prompt, state.params?.tools);
        const warningThresholdTokens = Math.floor(this.budgetProfile.tokenBudget * this.warningThresholdRatio);
        if (currentTokens < warningThresholdTokens) {
            return {
                reason: "below-warning-threshold",
                workingTokenBudget: this.budgetProfile.tokenBudget,
                payloads: {
                    kind: "context-utilization-reminder",
                    currentTokens,
                    warningThresholdTokens,
                    warningThresholdRatio: this.warningThresholdRatio,
                    mode: this.mode,
                    budgetLabel: this.budgetProfile.label,
                    budgetDescription: this.budgetProfile.description,
                },
            };
        }
        const utilizationPercent = Math.round((currentTokens / this.budgetProfile.tokenBudget) * 100);
        const reminderText = buildReminder({
            currentTokens,
            warningThresholdTokens,
            utilizationPercent,
            mode: this.mode,
            budgetLabel: this.budgetProfile.label,
            budgetDescription: this.budgetProfile.description,
        });
        await state.emitReminder({
            kind: "context-utilization",
            content: reminderText,
        });
        return {
            reason: "warning-injected",
            workingTokenBudget: this.budgetProfile.tokenBudget,
            payloads: {
                kind: "context-utilization-reminder",
                currentTokens,
                warningThresholdTokens,
                warningThresholdRatio: this.warningThresholdRatio,
                utilizationPercent,
                mode: this.mode,
                budgetLabel: this.budgetProfile.label,
                budgetDescription: this.budgetProfile.description,
                reminderText,
            },
        };
    }
}
