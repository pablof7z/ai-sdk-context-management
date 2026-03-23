import type { ContextManagementStrategy, ContextManagementStrategyExecution, ContextManagementStrategyState, ContextUtilizationReminderStrategyOptions } from "../../types.js";
export declare class ContextUtilizationReminderStrategy implements ContextManagementStrategy {
    readonly name = "context-utilization-reminder";
    private readonly budgetProfile;
    private readonly warningThresholdRatio;
    private readonly mode;
    constructor(options: ContextUtilizationReminderStrategyOptions);
    apply(state: ContextManagementStrategyState): Promise<ContextManagementStrategyExecution>;
}
