import type { ContextManagementStrategy, ContextManagementStrategyExecution, ContextManagementStrategyState, RemindersStrategyOptions } from "../../types.js";
export declare class RemindersStrategy<TData = unknown> implements ContextManagementStrategy {
    readonly name = "reminders";
    private readonly stateStore;
    private readonly providers;
    private readonly placementPolicy?;
    private readonly contextUtilization?;
    private readonly contextWindowStatus?;
    private readonly overlayType;
    constructor(options?: RemindersStrategyOptions<TData>);
    private appendOverlayMessages;
    private loadReminderState;
    private saveReminderState;
    private evaluateStatefulDescriptor;
    private evaluateContextUtilization;
    private evaluateContextWindowStatus;
    apply(state: ContextManagementStrategyState): Promise<ContextManagementStrategyExecution>;
}
