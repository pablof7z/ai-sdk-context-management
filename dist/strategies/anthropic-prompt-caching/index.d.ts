import type { AnthropicPromptCachingStrategyOptions, ContextManagementStrategy, ContextManagementStrategyExecution, ContextManagementStrategyState } from "../../types.js";
export declare class AnthropicPromptCachingStrategy implements ContextManagementStrategy {
    readonly name = "anthropic-prompt-caching";
    private readonly ttl;
    private readonly tracker;
    constructor(options?: AnthropicPromptCachingStrategyOptions);
    apply(state: ContextManagementStrategyState): ContextManagementStrategyExecution;
}
