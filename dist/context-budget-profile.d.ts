import type { ContextBudgetProfile, PromptTokenEstimator } from "./types.js";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { ToolSet } from "ai";
export interface NormalizedContextBudgetProfile {
    tokenBudget: number;
    estimator: PromptTokenEstimator;
    label: string;
    description?: string;
}
export declare function normalizeContextBudgetProfile(profile: ContextBudgetProfile | undefined): NormalizedContextBudgetProfile | undefined;
export declare function estimateBudgetProfileTokens(profile: NormalizedContextBudgetProfile, prompt: LanguageModelV3CallOptions["prompt"], tools: ToolSet | undefined): number;
