import { jsonSchema, tool, type ToolSet } from "ai";
import { clonePrompt, collectToolExchanges } from "./prompt-utils.js";
import { createDefaultPromptTokenEstimator } from "./token-estimator.js";
import { CONTEXT_MANAGEMENT_KEY } from "./types.js";
import type {
  CompactionStore,
  CompactionStoreKey,
  CompactionToolStrategyOptions,
  ContextManagementRequestContext,
  ContextManagementStrategy,
  ContextManagementStrategyState,
  PromptTokenEstimator,
  RemovedToolExchange,
} from "./types.js";
import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";

const DEFAULT_KEEP_LAST_MESSAGES = 8;

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

function buildCompactionKey(context: ContextManagementRequestContext): CompactionStoreKey {
  return {
    conversationId: context.conversationId,
    agentId: context.agentId,
  };
}

function buildSummarySystemMessage(summaryText: string): LanguageModelV3Message {
  return {
    role: "system",
    content: summaryText,
    providerOptions: { contextManagement: { type: "compaction-summary" } },
  };
}

function splitPromptForSummarization(
  prompt: LanguageModelV3Prompt,
  keepLastMessages: number
): { summarizable: LanguageModelV3Message[]; tail: LanguageModelV3Prompt } {
  const systemMessages: LanguageModelV3Message[] = [];
  const nonSystemMessages: LanguageModelV3Message[] = [];

  for (const message of prompt) {
    if (message.role === "system") {
      systemMessages.push(message);
    } else {
      nonSystemMessages.push(message);
    }
  }

  const tailCount = Math.min(keepLastMessages, nonSystemMessages.length);
  const summarizable = nonSystemMessages.slice(0, nonSystemMessages.length - tailCount);
  const keptTail = nonSystemMessages.slice(nonSystemMessages.length - tailCount);

  return {
    summarizable,
    tail: [...systemMessages, ...keptTail],
  };
}

function computeRemovedToolExchanges(
  originalPrompt: LanguageModelV3Prompt,
  nextPrompt: LanguageModelV3Prompt
): RemovedToolExchange[] {
  const original = collectToolExchanges(originalPrompt);
  const next = collectToolExchanges(nextPrompt);
  const removed: RemovedToolExchange[] = [];

  for (const exchange of original.values()) {
    if (next.has(exchange.toolCallId)) {
      continue;
    }

    removed.push({
      toolCallId: exchange.toolCallId,
      toolName: exchange.toolName,
      reason: "compaction",
    });
  }

  return removed;
}

export class CompactionToolStrategy implements ContextManagementStrategy {
  readonly name = "compaction-tool";
  private readonly summarize: (messages: LanguageModelV3Message[]) => Promise<string>;
  private readonly keepLastMessages: number;
  private readonly compactionStore?: CompactionStore;
  private readonly estimator: PromptTokenEstimator;
  private readonly optionalTools: ToolSet;
  private pendingCompaction = false;

  constructor(options: CompactionToolStrategyOptions) {
    this.summarize = options.summarize;
    this.keepLastMessages = Math.max(0, Math.floor(options.keepLastMessages ?? DEFAULT_KEEP_LAST_MESSAGES));
    this.compactionStore = options.compactionStore;
    this.estimator = options.estimator ?? createDefaultPromptTokenEstimator();
    this.optionalTools = {
      compact_context: tool<Record<string, never>, { ok: true; message: string }>({
        description: "Compact the conversation context by summarizing older messages. Call this when the context is getting large.",
        inputSchema: jsonSchema({
          type: "object",
          additionalProperties: false,
          properties: {},
        }),
        execute: async (_input, options) => {
          extractRequestContextFromExperimentalContext(options.experimental_context);
          this.pendingCompaction = true;
          return {
            ok: true,
            message: "Context will be compacted before the next model call.",
          };
        },
      }),
    };
  }

  getOptionalTools(): ToolSet {
    return this.optionalTools;
  }

  async apply(state: ContextManagementStrategyState): Promise<void> {
    if (this.compactionStore && !this.pendingCompaction) {
      const key = buildCompactionKey(state.requestContext);
      const storedSummary = await this.compactionStore.get(key);

      if (storedSummary) {
        const cloned = clonePrompt(state.prompt);
        const lastSystemIndex = cloned.reduce(
          (lastIndex, message, index) => (message.role === "system" ? index : lastIndex),
          -1
        );
        const insertIndex = lastSystemIndex + 1;
        cloned.splice(insertIndex, 0, buildSummarySystemMessage(storedSummary));
        state.updatePrompt(cloned);
      }
    }

    if (!this.pendingCompaction) {
      return;
    }

    this.pendingCompaction = false;

    const { summarizable, tail } = splitPromptForSummarization(state.prompt, this.keepLastMessages);

    if (summarizable.length === 0) {
      return;
    }

    const summaryText = await this.summarize(summarizable);
    const summaryMessage = buildSummarySystemMessage(summaryText);

    const systemMessages = tail.filter((message) => message.role === "system");
    const nonSystemTail = tail.filter((message) => message.role !== "system");
    const nextPrompt: LanguageModelV3Prompt = [...systemMessages, summaryMessage, ...nonSystemTail];

    const removedExchanges = computeRemovedToolExchanges(state.prompt, nextPrompt);
    state.addRemovedToolExchanges(removedExchanges);

    if (this.compactionStore) {
      const key = buildCompactionKey(state.requestContext);
      await this.compactionStore.set(key, summaryText);
    }

    state.updatePrompt(nextPrompt);
  }
}
