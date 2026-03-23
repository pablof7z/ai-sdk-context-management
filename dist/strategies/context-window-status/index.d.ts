import type { ContextManagementStrategy, ContextManagementStrategyExecution, ContextManagementStrategyState, ContextWindowStatusStrategyOptions } from "../../types.js";
export declare class ContextWindowStatusStrategy implements ContextManagementStrategy {
    readonly name = "context-window-status";
    private readonly budgetProfile?;
    private readonly requestEstimator;
    private readonly getContextWindow?;
    constructor(options?: ContextWindowStatusStrategyOptions);
    apply(state: ContextManagementStrategyState): Promise<ContextManagementStrategyExecution>;
}
