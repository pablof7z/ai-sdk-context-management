import { jsonSchema, tool } from "ai";
import { CONTEXT_MANAGEMENT_KEY } from "../../../types.js";
import type { ContextManagementRequestContext } from "../../../types.js";

function extractRequestContextFromExperimentalContext(
  experimentalContext: unknown
): ContextManagementRequestContext {
  if (
    !experimentalContext ||
    typeof experimentalContext !== "object" ||
    !(CONTEXT_MANAGEMENT_KEY in experimentalContext)
  ) {
    throw new Error("compact_context tool requires experimental_context.contextManagement");
  }

  const raw = (experimentalContext as Record<string, unknown>)[CONTEXT_MANAGEMENT_KEY];
  if (!raw || typeof raw !== "object") {
    throw new Error("compact_context tool requires a valid contextManagement request context");
  }

  const conversationId = (raw as Record<string, unknown>).conversationId;
  const agentId = (raw as Record<string, unknown>).agentId;

  if (typeof conversationId !== "string" || conversationId.length === 0) {
    throw new Error("compact_context tool requires contextManagement.conversationId");
  }

  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new Error("compact_context tool requires contextManagement.agentId");
  }

  return { conversationId, agentId };
}

function buildCompactionRequestKey(context: ContextManagementRequestContext): string {
  return `${context.conversationId}:${context.agentId}`;
}

export function createCompactContextTool(options: {
  pendingCompactionKeys: Set<string>;
}) {
  return tool<Record<string, never>, { ok: true; message: string }>({
    description: "Compact the conversation context by summarizing older messages. Call this when the context is getting large.",
    inputSchema: jsonSchema({
      type: "object",
      additionalProperties: false,
      properties: {},
    }),
    execute: async (_input, executeOptions) => {
      const requestContext = extractRequestContextFromExperimentalContext(
        executeOptions.experimental_context
      );
      options.pendingCompactionKeys.add(buildCompactionRequestKey(requestContext));
      return {
        ok: true,
        message: "Context will be compacted before the next model call.",
      };
    },
  });
}
