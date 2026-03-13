import { clonePrompt, collectToolExchanges } from "./prompt-utils.js";
import { createDefaultPromptTokenEstimator } from "./token-estimator.js";
import type {
  ContextManagementStrategy,
  ContextManagementStrategyState,
  PromptTokenEstimator,
  RemovedToolExchange,
  SummarizationStrategyOptions,
} from "./types.js";
import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";

const DEFAULT_KEEP_LAST_MESSAGES = 8;

function isSummaryMessage(message: LanguageModelV3Message): boolean {
  const opts = message.providerOptions;
  if (!opts || typeof opts !== "object") return false;
  const cm = opts.contextManagement;
  if (!cm || typeof cm !== "object") return false;
  return (cm as Record<string, unknown>).type === "summary";
}

function computeTailStartIndex(nonSystemMessages: LanguageModelV3Message[], keepLastMessages: number, prompt: LanguageModelV3Prompt): number {
  if (keepLastMessages <= 0 || nonSystemMessages.length === 0) {
    return nonSystemMessages.length;
  }

  if (keepLastMessages >= nonSystemMessages.length) {
    return 0;
  }

  let startIndex = nonSystemMessages.length - keepLastMessages;

  // Preserve tool-call/tool-result adjacency: if a tool result is in the tail
  // but its corresponding tool call is before the boundary, pull the boundary back.
  const exchanges = collectToolExchanges(prompt);
  const nonSystemIndices = prompt.flatMap((message, index) => message.role === "system" ? [] : [index]);

  for (;;) {
    let nextStartIndex = startIndex;

    for (const exchange of exchanges.values()) {
      // Check if any result message is in the tail (i.e., its non-system index >= startIndex)
      const hasKeptResult = exchange.resultMessageIndices.some((globalIndex) => {
        const nonSysIdx = nonSystemIndices.indexOf(globalIndex);
        return nonSysIdx >= startIndex;
      });

      if (!hasKeptResult || exchange.callMessageIndex === undefined) {
        continue;
      }

      const callNonSysIdx = nonSystemIndices.indexOf(exchange.callMessageIndex);
      if (callNonSysIdx !== -1 && callNonSysIdx < nextStartIndex) {
        nextStartIndex = callNonSysIdx;
      }
    }

    if (nextStartIndex === startIndex) {
      return startIndex;
    }

    startIndex = nextStartIndex;
  }
}

export class SummarizationStrategy implements ContextManagementStrategy {
  readonly name = "summarization";
  private readonly summarize: SummarizationStrategyOptions["summarize"];
  private readonly maxPromptTokens: number;
  private readonly keepLastMessages: number;
  private readonly estimator: PromptTokenEstimator;

  constructor(options: SummarizationStrategyOptions) {
    this.summarize = options.summarize;
    this.maxPromptTokens = options.maxPromptTokens;
    this.keepLastMessages = Math.max(0, Math.floor(options.keepLastMessages ?? DEFAULT_KEEP_LAST_MESSAGES));
    this.estimator = options.estimator ?? createDefaultPromptTokenEstimator();
  }

  async apply(state: ContextManagementStrategyState): Promise<void> {
    const estimatedTokens = this.estimator.estimatePrompt(state.prompt);

    if (estimatedTokens <= this.maxPromptTokens) {
      return;
    }

    const prompt = state.prompt;

    // Split into system messages, non-system messages
    const systemMessages: LanguageModelV3Message[] = [];
    const nonSystemMessages: LanguageModelV3Message[] = [];

    for (const message of prompt) {
      if (message.role === "system") {
        systemMessages.push(message);
      } else {
        nonSystemMessages.push(message);
      }
    }

    // Compute the tail start index
    const tailStartIndex = computeTailStartIndex(nonSystemMessages, this.keepLastMessages, prompt);

    // Split non-system messages into summarizable and tail
    const summarizableMessages = nonSystemMessages.slice(0, tailStartIndex);
    const tailMessages = nonSystemMessages.slice(tailStartIndex);

    if (summarizableMessages.length === 0) {
      return;
    }

    // Find existing summary message in system messages and include it in the summarization input
    const existingSummaryIndex = systemMessages.findIndex(isSummaryMessage);
    const existingSummary = existingSummaryIndex !== -1 ? systemMessages[existingSummaryIndex] : null;

    // Build the messages to pass to summarize
    const messagesToSummarize: LanguageModelV3Message[] = [];
    if (existingSummary) {
      messagesToSummarize.push(existingSummary);
    }
    messagesToSummarize.push(...summarizableMessages);

    // Call summarize
    const summaryText = await this.summarize(messagesToSummarize);

    // Build the summary system message
    const summaryMessage: LanguageModelV3Message = {
      role: "system",
      content: summaryText,
      providerOptions: { contextManagement: { type: "summary" } },
    };

    // Build the new prompt: system messages (without old summary) + summary message + tail
    const nonSummarySystemMessages = systemMessages.filter((_, i) => i !== existingSummaryIndex);
    const newPrompt: LanguageModelV3Prompt = [
      ...nonSummarySystemMessages,
      summaryMessage,
      ...tailMessages,
    ];

    // Compute removed tool exchanges
    const originalExchanges = collectToolExchanges(prompt);
    const newExchanges = collectToolExchanges(newPrompt);
    const removedExchanges: RemovedToolExchange[] = [];

    for (const exchange of originalExchanges.values()) {
      if (!newExchanges.has(exchange.toolCallId)) {
        removedExchanges.push({
          toolCallId: exchange.toolCallId,
          toolName: exchange.toolName,
          reason: "summarization",
        });
      }
    }

    state.updatePrompt(newPrompt);
    state.addRemovedToolExchanges(removedExchanges);
  }
}
