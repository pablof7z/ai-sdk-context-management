import type {
  ContextBudgetProfile,
  PromptTokenEstimator,
} from "./types.js";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { ToolSet } from "ai";

export interface NormalizedContextBudgetProfile {
  tokenBudget: number;
  estimator: PromptTokenEstimator;
  label: string;
  description?: string;
}

export function normalizeContextBudgetProfile(
  profile: ContextBudgetProfile | undefined
): NormalizedContextBudgetProfile | undefined {
  if (!profile) {
    return undefined;
  }

  const label = profile.label?.trim();
  const description = profile.description?.trim();

  return {
    tokenBudget: Math.max(1, Math.floor(profile.tokenBudget)),
    estimator: profile.estimator,
    label: label && label.length > 0 ? label : "working budget",
    ...(description && description.length > 0 ? { description } : {}),
  };
}

export function estimateBudgetProfileTokens(
  profile: NormalizedContextBudgetProfile,
  prompt: LanguageModelV3CallOptions["prompt"],
  tools: ToolSet | undefined
): number {
  return profile.estimator.estimatePrompt(prompt) + (profile.estimator.estimateTools?.(tools) ?? 0);
}
