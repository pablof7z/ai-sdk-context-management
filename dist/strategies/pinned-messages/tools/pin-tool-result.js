import { jsonSchema, tool } from "ai";
import { CONTEXT_MANAGEMENT_KEY } from "../../../types.js";
function extractRequestContextFromExperimentalContext(experimentalContext) {
    if (!experimentalContext ||
        typeof experimentalContext !== "object" ||
        !(CONTEXT_MANAGEMENT_KEY in experimentalContext)) {
        throw new Error("pin_tool_result tool requires experimental_context.contextManagement");
    }
    const raw = experimentalContext[CONTEXT_MANAGEMENT_KEY];
    if (!raw || typeof raw !== "object") {
        throw new Error("pin_tool_result tool requires a valid contextManagement request context");
    }
    const conversationId = raw.conversationId;
    const agentId = raw.agentId;
    if (typeof conversationId !== "string" || conversationId.length === 0) {
        throw new Error("pin_tool_result tool requires contextManagement.conversationId");
    }
    if (typeof agentId !== "string" || agentId.length === 0) {
        throw new Error("pin_tool_result tool requires contextManagement.agentId");
    }
    return { conversationId, agentId };
}
function buildPinnedKey(context) {
    return {
        conversationId: context.conversationId,
        agentId: context.agentId,
    };
}
export function createPinToolResultTool(options) {
    return tool({
        description: "Pin or unpin tool call results to protect them from being pruned by context management.",
        inputSchema: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
                pin: {
                    type: "array",
                    items: { type: "string" },
                    description: "Tool call IDs to protect from pruning.",
                },
                unpin: {
                    type: "array",
                    items: { type: "string" },
                    description: "Tool call IDs to stop protecting from pruning.",
                },
            },
        }),
        execute: async (input, executeOptions) => {
            const requestContext = extractRequestContextFromExperimentalContext(executeOptions.experimental_context);
            const key = buildPinnedKey(requestContext);
            const current = (await options.pinnedStore.get(key)) ?? [];
            const unpinSet = new Set(input.unpin ?? []);
            const filtered = current.filter((id) => !unpinSet.has(id));
            const existingSet = new Set(filtered);
            const toAdd = (input.pin ?? []).filter((id) => !existingSet.has(id));
            const merged = [...filtered, ...toAdd];
            const enforced = merged.length > options.maxPinned
                ? merged.slice(merged.length - options.maxPinned)
                : merged;
            await options.pinnedStore.set(key, enforced);
            return { ok: true, pinned: enforced };
        },
    });
}
