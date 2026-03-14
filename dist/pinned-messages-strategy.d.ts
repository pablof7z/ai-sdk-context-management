import { type ToolSet } from "ai";
import type { ContextManagementStrategy, ContextManagementStrategyState, PinnedMessagesStrategyOptions } from "./types.js";
export declare class PinnedMessagesStrategy implements ContextManagementStrategy {
    readonly name = "pinned-messages";
    private readonly pinnedStore;
    private readonly maxPinned;
    private readonly optionalTools;
    constructor(options: PinnedMessagesStrategyOptions);
    getOptionalTools(): ToolSet;
    apply(state: ContextManagementStrategyState): Promise<void>;
}
