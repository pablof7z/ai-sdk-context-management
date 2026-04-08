import { getLatestToolActivity, projectScratchpadPrompt, } from "../../prompt-utils.js";
import { estimateBudgetProfileTokens, normalizeContextBudgetProfile, } from "../../context-budget-profile.js";
import { createDefaultPromptTokenEstimator } from "../../token-estimator.js";
import { createScratchpadTool } from "./tools/scratchpad.js";
import { countEntryChars, indentMultiline, normalizeScratchpadState, renderScratchpadState, } from "./state.js";
function buildScratchpadKey(context) {
    return {
        conversationId: context.conversationId,
        agentId: context.agentId,
    };
}
function buildReminderBlock(options) {
    const { currentState, currentContext, otherScratchpads, emptyStateGuidanceLines, forced, } = options;
    const currentLines = renderScratchpadState(currentState);
    const currentIsEmpty = currentLines.length === 0;
    const lines = [];
    if (!currentIsEmpty) {
        lines.push(`Your scratchpad (${currentContext.agentLabel ?? currentContext.agentId}):`);
        lines.push(...currentLines);
    }
    const otherAgentNotes = otherScratchpads
        .map((entry) => ({
        agentLabel: entry.agentLabel ?? entry.state.agentLabel ?? entry.agentId,
        body: renderScratchpadState(normalizeScratchpadState(entry.state)),
    }))
        .filter((entry) => entry.body.length > 0);
    if (otherAgentNotes.length > 0) {
        lines.push("Other agent scratchpads:");
        for (const entry of otherAgentNotes) {
            lines.push(`- ${entry.agentLabel}:`);
            lines.push(indentMultiline(entry.body.join("\n")));
        }
    }
    if (forced) {
        lines.push("CRITICAL: Context is nearly full. You MUST:", "1. Update scratchpad entries to match the current state you want preserved", "2. Set preserveTurns to compact older turns (e.g. 2-4)", "Failure to free context will result in an error.");
    }
    else if ((currentState.entries === undefined || Object.keys(currentState.entries).length === 0)
        && emptyStateGuidanceLines.length > 0) {
        lines.push(...emptyStateGuidanceLines);
    }
    return lines.join("\n");
}
function hasScratchpadState(state) {
    return Object.keys(state.entries ?? {}).length > 0
        || state.activeNotice !== undefined
        || typeof state.preserveTurns === "number";
}
function hasVisibleOtherScratchpads(entries) {
    return entries.some((entry) => {
        const body = renderScratchpadState(normalizeScratchpadState(entry.state));
        return body.length > 0;
    });
}
export class ScratchpadStrategy {
    name = "scratchpad";
    scratchpadStore;
    emptyStateGuidanceLines;
    budgetProfile;
    forceToolThresholdRatio;
    estimator = createDefaultPromptTokenEstimator();
    optionalTools;
    forcedOnLastApply = false;
    constructor(options) {
        const normalizedBudgetProfile = normalizeContextBudgetProfile(options.budgetProfile);
        const normalizedForceThresholdRatio = typeof options.forceToolThresholdRatio === "number"
            && Number.isFinite(options.forceToolThresholdRatio)
            ? Math.min(1, Math.max(0, options.forceToolThresholdRatio))
            : undefined;
        if (normalizedForceThresholdRatio !== undefined && normalizedBudgetProfile === undefined) {
            throw new Error("ScratchpadStrategy forceToolThresholdRatio requires budgetProfile");
        }
        this.scratchpadStore = options.scratchpadStore;
        this.emptyStateGuidanceLines = (Array.isArray(options.emptyStateGuidance)
            ? options.emptyStateGuidance
            : typeof options.emptyStateGuidance === "string"
                ? [options.emptyStateGuidance]
                : [])
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        this.budgetProfile = normalizedBudgetProfile;
        this.forceToolThresholdRatio = normalizedForceThresholdRatio;
        this.optionalTools = {
            scratchpad: createScratchpadTool({
                scratchpadStore: this.scratchpadStore,
                consumeForcedCall: () => {
                    const wasForcedCall = this.forcedOnLastApply;
                    this.forcedOnLastApply = false;
                    return wasForcedCall;
                },
            }),
        };
    }
    getOptionalTools() {
        return this.optionalTools;
    }
    async apply(state) {
        const latestToolActivity = getLatestToolActivity(state.prompt);
        const [currentStateRaw, allScratchpadsRaw] = await Promise.all([
            this.scratchpadStore.get(buildScratchpadKey(state.requestContext)),
            this.scratchpadStore.listConversation(state.requestContext.conversationId),
        ]);
        const currentState = normalizeScratchpadState(currentStateRaw, state.requestContext.agentLabel);
        const allScratchpads = (allScratchpadsRaw ?? []).filter((entry) => entry.agentId !== state.requestContext.agentId);
        state.updatePrompt(projectScratchpadPrompt(state.prompt, {
            preserveTurns: currentState.preserveTurns,
            notice: currentState.activeNotice,
        }));
        const estimatedTokens = this.budgetProfile
            ? estimateBudgetProfileTokens(this.budgetProfile, state.prompt, state.params?.tools)
            : this.estimator.estimatePrompt(state.prompt)
                + (this.estimator.estimateTools?.(state.params?.tools) ?? 0);
        const forceThresholdTokens = this.forceToolThresholdRatio !== undefined
            && this.budgetProfile !== undefined
            ? Math.floor(this.budgetProfile.tokenBudget * this.forceToolThresholdRatio)
            : undefined;
        const alreadyForcedToScratchpad = typeof state.params?.toolChoice === "object"
            && state.params.toolChoice !== null
            && state.params.toolChoice.type === "tool"
            && state.params.toolChoice.toolName === "scratchpad";
        const justCalledScratchpad = latestToolActivity?.toolName === "scratchpad";
        const shouldForceToolChoice = forceThresholdTokens !== undefined
            && estimatedTokens >= forceThresholdTokens
            && !alreadyForcedToScratchpad
            && !justCalledScratchpad;
        const shouldRenderReminder = shouldForceToolChoice
            || hasScratchpadState(currentState)
            || hasVisibleOtherScratchpads(allScratchpads)
            || this.emptyStateGuidanceLines.length > 0;
        if (shouldRenderReminder) {
            const reminderBlock = buildReminderBlock({
                currentState,
                currentContext: state.requestContext,
                otherScratchpads: allScratchpads,
                emptyStateGuidanceLines: this.emptyStateGuidanceLines,
                forced: shouldForceToolChoice,
            });
            if (reminderBlock.length > 0) {
                await state.emitReminder({
                    kind: "scratchpad",
                    content: reminderBlock,
                });
            }
        }
        if (shouldForceToolChoice) {
            this.forcedOnLastApply = true;
            state.updateParams({
                toolChoice: {
                    type: "tool",
                    toolName: "scratchpad",
                },
            });
        }
        return {
            outcome: shouldForceToolChoice
                ? "applied"
                : shouldRenderReminder
                    ? undefined
                    : "skipped",
            reason: shouldForceToolChoice
                ? "scratchpad-rendered-and-tool-forced"
                : shouldRenderReminder
                    ? "scratchpad-rendered"
                    : "scratchpad-idle",
            ...(this.budgetProfile !== undefined ? { workingTokenBudget: this.budgetProfile.tokenBudget } : {}),
            payloads: {
                kind: "scratchpad",
                entryCount: Object.keys(currentState.entries ?? {}).length,
                entryCharCount: countEntryChars(currentState.entries),
                preserveTurns: currentState.preserveTurns,
                activeNoticeDescription: currentState.activeNotice?.description,
                activeNoticeToolCallId: currentState.activeNotice?.toolCallId,
                activeNoticeRawTurnCountAtCall: currentState.activeNotice?.rawTurnCountAtCall,
                activeNoticeProjectedTurnCountAtCall: currentState.activeNotice?.projectedTurnCountAtCall,
                otherScratchpadCount: allScratchpads.length,
                estimatedTokens,
                forceToolThresholdRatio: this.forceToolThresholdRatio,
                forceThresholdTokens,
                forcedToolChoice: shouldForceToolChoice,
                latestToolName: latestToolActivity?.toolName,
            },
        };
    }
}
