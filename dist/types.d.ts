import type { LanguageModelV3CallOptions, LanguageModelV3Message, LanguageModelV3Middleware, LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { ToolSet } from "ai";
export declare const CONTEXT_MANAGEMENT_KEY = "contextManagement";
export interface ContextManagementRequestContext {
    conversationId: string;
    agentId: string;
    agentLabel?: string;
}
export interface RemovedToolExchange {
    toolCallId: string;
    toolName: string;
    reason: string;
}
export interface ContextManagementStrategyState {
    readonly params: LanguageModelV3CallOptions;
    readonly prompt: LanguageModelV3Prompt;
    readonly requestContext: ContextManagementRequestContext;
    readonly removedToolExchanges: readonly RemovedToolExchange[];
    readonly pinnedToolCallIds: ReadonlySet<string>;
    updatePrompt(prompt: LanguageModelV3Prompt): void;
    addRemovedToolExchanges(exchanges: RemovedToolExchange[]): void;
    addPinnedToolCallIds(toolCallIds: string[]): void;
}
export interface ContextManagementStrategy {
    readonly name?: string;
    apply(state: ContextManagementStrategyState): Promise<void> | void;
    getOptionalTools?(): ToolSet;
}
export interface CreateContextManagementRuntimeOptions {
    strategies: ContextManagementStrategy[];
}
export interface ContextManagementRuntime {
    middleware: LanguageModelV3Middleware;
    optionalTools: ToolSet;
}
export interface PromptTokenEstimator {
    estimatePrompt(prompt: LanguageModelV3Prompt): number;
    estimateMessage(message: LanguageModelV3Message): number;
}
export interface ToolResultDecayStrategyOptions {
    keepFullResultCount?: number;
    truncatedMaxTokens?: number;
    truncateWindowCount?: number;
    maxPromptTokens?: number;
    placeholder?: string | ((toolName: string, toolCallId: string) => string);
    estimator?: PromptTokenEstimator;
}
export interface HeadAndTailStrategyOptions {
    headCount?: number;
    tailCount?: number;
}
export interface SystemPromptCachingStrategyOptions {
    consolidateSystemMessages?: boolean;
}
export interface SummarizationStrategyOptions {
    summarize: (messages: LanguageModelV3Message[]) => Promise<string>;
    maxPromptTokens: number;
    keepLastMessages?: number;
    estimator?: PromptTokenEstimator;
}
export interface CompactionStoreKey {
    conversationId: string;
    agentId: string;
}
export interface CompactionStore {
    get(key: CompactionStoreKey): Promise<string | undefined> | string | undefined;
    set(key: CompactionStoreKey, summary: string): Promise<void> | void;
}
export interface CompactionToolStrategyOptions {
    summarize: (messages: LanguageModelV3Message[]) => Promise<string>;
    keepLastMessages?: number;
    compactionStore?: CompactionStore;
    estimator?: PromptTokenEstimator;
}
export interface PinnedStoreKey {
    conversationId: string;
    agentId: string;
}
export interface PinnedStore {
    get(key: PinnedStoreKey): Promise<string[]> | string[];
    set(key: PinnedStoreKey, toolCallIds: string[]): Promise<void> | void;
}
export interface PinnedMessagesStrategyOptions {
    pinnedStore: PinnedStore;
    maxPinned?: number;
}
export interface SlidingWindowStrategyOptions {
    keepLastMessages?: number;
    maxPromptTokens?: number;
    estimator?: PromptTokenEstimator;
}
export interface ScratchpadStoreKey {
    conversationId: string;
    agentId: string;
}
export interface ScratchpadState {
    notes: string;
    keepLastMessages?: number | null;
    omitToolCallIds: string[];
    updatedAt?: number;
    agentLabel?: string;
}
export interface ScratchpadConversationEntry {
    agentId: string;
    agentLabel?: string;
    state: ScratchpadState;
}
export interface ScratchpadStore {
    get(key: ScratchpadStoreKey): Promise<ScratchpadState | undefined> | ScratchpadState | undefined;
    set(key: ScratchpadStoreKey, state: ScratchpadState): Promise<void> | void;
    listConversation(conversationId: string): Promise<ScratchpadConversationEntry[] | undefined> | ScratchpadConversationEntry[] | undefined;
}
export interface ScratchpadStrategyOptions {
    scratchpadStore: ScratchpadStore;
    maxRemovedToolReminderItems?: number;
}
export interface ScratchpadToolInput {
    notes?: string;
    keepLastMessages?: number | null;
    omitToolCallIds?: string[];
}
export interface ScratchpadToolResult {
    ok: true;
    state: ScratchpadState;
}
