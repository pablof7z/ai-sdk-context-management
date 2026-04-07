export function normalizeContextBudgetProfile(profile) {
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
export function estimateBudgetProfileTokens(profile, prompt, tools) {
    return profile.estimator.estimatePrompt(prompt) + (profile.estimator.estimateTools?.(tools) ?? 0);
}
