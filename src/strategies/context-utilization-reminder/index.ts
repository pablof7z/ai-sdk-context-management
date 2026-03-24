import {
  estimateBudgetProfileTokens,
  normalizeContextBudgetProfile,
  type NormalizedContextBudgetProfile,
} from "../../context-budget-profile.js";
import type {
  ContextManagementStrategy,
  ContextManagementStrategyExecution,
  ContextManagementStrategyState,
  ContextUtilizationReminderStrategyOptions,
} from "../../types.js";

const DEFAULT_WARNING_THRESHOLD_RATIO = 0.7;

function buildReminder(options: {
  currentTokens: number;
  warningThresholdTokens: number;
  utilizationPercent: number;
  mode: "scratchpad" | "generic";
  budgetLabel: string;
  budgetDescription?: string;
}): string {
  const {
    currentTokens,
    warningThresholdTokens,
    utilizationPercent,
    mode,
    budgetLabel,
    budgetDescription,
  } = options;

  const lines = [
    `[Context utilization: ~${utilizationPercent}% of ${budgetLabel}]`,
    `Current ${budgetLabel} tokens: ~${currentTokens}. Warning threshold: ~${warningThresholdTokens}.`,
  ];

  if (budgetDescription) {
    lines.push(budgetDescription);
  }

  if (mode === "scratchpad") {
    lines.push(`Your ${budgetLabel} is getting tight. scratchpad(...) is available for context compaction:`);
    lines.push("- setEntries or replaceEntries update persisted scratchpad state");
    lines.push("- omitToolCallIds removes completed tool exchanges from visible context");
    lines.push("- preserveTurns keeps only the head and tail turns around the pruning point");
  } else {
    lines.push(`Your ${budgetLabel} is getting tight. Trim or summarize stale context before continuing.`);
  }

  lines.push("[/Context utilization]");
  return lines.join("\n");
}

export class ContextUtilizationReminderStrategy implements ContextManagementStrategy {
  readonly name = "context-utilization-reminder";
  private readonly budgetProfile: NormalizedContextBudgetProfile;
  private readonly warningThresholdRatio: number;
  private readonly mode: "scratchpad" | "generic";

  constructor(options: ContextUtilizationReminderStrategyOptions) {
    this.budgetProfile = normalizeContextBudgetProfile(options.budgetProfile)!;
    this.warningThresholdRatio = Math.min(
      1,
      Math.max(0, options.warningThresholdRatio ?? DEFAULT_WARNING_THRESHOLD_RATIO)
    );
    this.mode = options.mode ?? "generic";
  }

  async apply(state: ContextManagementStrategyState): Promise<ContextManagementStrategyExecution> {
    const currentTokens = estimateBudgetProfileTokens(
      this.budgetProfile,
      state.prompt,
      state.params?.tools
    );
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
