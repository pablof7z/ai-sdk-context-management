import { jsonSchema, tool } from "ai";
import { countProjectedScratchpadTurns, countScratchpadSemanticTurns, } from "../../../prompt-utils.js";
import { CONTEXT_MANAGEMENT_KEY } from "../../../types.js";
import { dedupeStrings, mergeEntryMaps, normalizeEntryMap, normalizePreserveTurns, normalizeScratchpadState, removeEntryKeys, } from "../state.js";
function buildScratchpadKey(context) {
    return {
        conversationId: context.conversationId,
        agentId: context.agentId,
    };
}
function extractRequestContextFromExperimentalContext(experimentalContext) {
    if (!experimentalContext ||
        typeof experimentalContext !== "object" ||
        !(CONTEXT_MANAGEMENT_KEY in experimentalContext)) {
        throw new Error("scratchpad tool requires experimental_context.contextManagement");
    }
    const raw = experimentalContext[CONTEXT_MANAGEMENT_KEY];
    if (!raw || typeof raw !== "object") {
        throw new Error("scratchpad tool requires a valid contextManagement request context");
    }
    const conversationId = raw.conversationId;
    const agentId = raw.agentId;
    const agentLabel = raw.agentLabel;
    if (typeof conversationId !== "string" || conversationId.length === 0) {
        throw new Error("scratchpad tool requires contextManagement.conversationId");
    }
    if (typeof agentId !== "string" || agentId.length === 0) {
        throw new Error("scratchpad tool requires contextManagement.agentId");
    }
    return {
        conversationId,
        agentId,
        ...(typeof agentLabel === "string" && agentLabel.length > 0 ? { agentLabel } : {}),
    };
}
export function createScratchpadTool(options) {
    return tool({
        description: "Manage your working memory and active attention. Every call must include a short description of what you are doing. Use key/value entries to keep the current working state for this run. Multiline values are fine, and common keys include objective, requirements, findings, notes, side-effects, completion-state, and next-steps. Prefer rewriting stale state over keeping a chronological log.\n\nUse this proactively and often, not only when context is large. After information-gathering bursts, side effects, requirement changes, decisions, and task transitions, update your scratchpad so it becomes the source of truth for ongoing work.\n\nIMPORTANT: Before pruning context, record in your scratchpad any actions you took that had side effects (file writes, API calls, published events, state changes), along with user requirements, constraints, and completion state (what is already done, what must not be repeated, and what is still pending). Once the scratchpad safely carries what you need, use preserveTurns and omitToolCallIds to remove stale transcript instead of leaving it around just in case.\n\npreserveTurns keeps the first N and last N user/assistant turns from before this scratchpad call and removes the middle. Preserved turns keep their raw messages, including tool calls and tool results that occurred inside those turns. Anything in the trimmed middle disappears from the visible transcript, so save what you still need first.",
        inputSchema: jsonSchema({
            type: "object",
            additionalProperties: false,
            required: ["description"],
            properties: {
                description: {
                    type: "string",
                    minLength: 1,
                    pattern: "\\S",
                    description: "One-line description of what this scratchpad update is doing right now.",
                },
                setEntries: {
                    type: "object",
                    additionalProperties: {
                        type: "string",
                    },
                    description: "Merge key/value entries into your scratchpad. Use any keys that fit the task, such as objective, requirements, findings, notes, side-effects, completion-state, or next-steps.",
                },
                replaceEntries: {
                    type: "object",
                    additionalProperties: {
                        type: "string",
                    },
                    description: "Replace all existing key/value entries with this new set.",
                },
                removeEntryKeys: {
                    type: "array",
                    items: {
                        type: "string",
                    },
                    description: "Remove specific key/value entries by key name.",
                },
                preserveTurns: {
                    anyOf: [
                        {
                            type: "integer",
                            minimum: 0,
                        },
                        {
                            type: "null",
                        },
                    ],
                    description: "Number of turns to keep from both the head and tail of the pre-scratchpad visible transcript. Preserved turns keep their raw messages, including tool calls and tool results inside those turns. Use null to clear.",
                },
                omitToolCallIds: {
                    type: "array",
                    items: {
                        type: "string",
                    },
                    description: "Tool call IDs whose request and result should be removed from context. Use for completed tool calls whose results you've already captured in your scratchpad.",
                },
            },
        }),
        execute: async (input, executeOptions) => {
            const requestContext = extractRequestContextFromExperimentalContext(executeOptions.experimental_context);
            const key = buildScratchpadKey(requestContext);
            const currentState = normalizeScratchpadState(await options.scratchpadStore.get(key), requestContext.agentLabel);
            const replacedEntries = input.replaceEntries !== undefined
                ? normalizeEntryMap(input.replaceEntries)
                : currentState.entries;
            const mergedEntries = input.setEntries !== undefined
                ? mergeEntryMaps(replacedEntries, input.setEntries)
                : replacedEntries;
            const nextEntries = removeEntryKeys(mergedEntries, input.removeEntryKeys);
            const preserveTurns = input.preserveTurns !== undefined
                ? normalizePreserveTurns(input.preserveTurns)
                : currentState.preserveTurns;
            const description = input.description.trim();
            if (description.length === 0) {
                throw new Error("scratchpad tool requires a non-empty description");
            }
            const toolCallId = typeof executeOptions.toolCallId === "string" && executeOptions.toolCallId.length > 0
                ? executeOptions.toolCallId
                : "scratchpad";
            const currentVisibleMessages = (executeOptions.messages ?? []);
            const currentVisibleTurnCount = countScratchpadSemanticTurns(currentVisibleMessages);
            const previousRawTurnCountAtCall = currentState.activeNotice?.rawTurnCountAtCall ?? 0;
            const previousProjectedTurnCountAtCall = currentState.activeNotice?.projectedTurnCountAtCall ?? 0;
            const rawTurnCountAtCall = Math.max(currentVisibleTurnCount, previousRawTurnCountAtCall + currentVisibleTurnCount - previousProjectedTurnCountAtCall);
            const projectedTurnCountAtCall = countProjectedScratchpadTurns(currentVisibleMessages, preserveTurns);
            await options.scratchpadStore.set(key, {
                ...(nextEntries ? { entries: nextEntries } : {}),
                ...(input.preserveTurns !== undefined
                    ? { preserveTurns }
                    : currentState.preserveTurns !== undefined
                        ? { preserveTurns: currentState.preserveTurns }
                        : {}),
                activeNotice: {
                    description,
                    toolCallId,
                    rawTurnCountAtCall,
                    projectedTurnCountAtCall,
                },
                ...(input.omitToolCallIds !== undefined
                    ? { omitToolCallIds: dedupeStrings(input.omitToolCallIds) }
                    : { omitToolCallIds: currentState.omitToolCallIds }),
                updatedAt: Date.now(),
                ...(requestContext.agentLabel
                    ? { agentLabel: requestContext.agentLabel }
                    : currentState.agentLabel
                        ? { agentLabel: currentState.agentLabel }
                        : {}),
            });
            if (options.consumeForcedCall()) {
                const hasPruningParams = input.preserveTurns !== undefined
                    || (input.omitToolCallIds !== undefined && input.omitToolCallIds.length > 0);
                if (!hasPruningParams) {
                    return {
                        ok: false,
                        error: "Context is critically full. You MUST free context by setting preserveTurns (integer) to compact older turns, and/or omitToolCallIds (array of tool call IDs) to remove completed tool results. Your scratchpad updates were saved, but you need to call scratchpad again with pruning parameters.",
                    };
                }
            }
            return {
                ok: true,
            };
        },
    });
}
