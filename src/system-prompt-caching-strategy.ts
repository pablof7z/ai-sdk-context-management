import { clonePrompt } from "./prompt-utils.js";
import type {
  ContextManagementStrategy,
  ContextManagementStrategyState,
  SystemPromptCachingStrategyOptions,
} from "./types.js";

export class SystemPromptCachingStrategy implements ContextManagementStrategy {
  readonly name = "system-prompt-caching";
  private readonly consolidateSystemMessages: boolean;

  constructor(options: SystemPromptCachingStrategyOptions = {}) {
    this.consolidateSystemMessages = options.consolidateSystemMessages ?? true;
  }

  apply(state: ContextManagementStrategyState): void {
    const prompt = clonePrompt(state.prompt);

    const systemMessages = prompt.filter((message) => message.role === "system");
    const nonSystemMessages = prompt.filter((message) => message.role !== "system");

    if (systemMessages.length === 0) {
      return;
    }

    let reorderedSystemMessages;

    if (this.consolidateSystemMessages && systemMessages.length > 1) {
      const consolidatedContent = systemMessages
        .map((message) => message.content)
        .join("\n\n");

      reorderedSystemMessages = [
        { role: "system" as const, content: consolidatedContent },
      ];
    } else {
      reorderedSystemMessages = systemMessages;
    }

    state.updatePrompt([...reorderedSystemMessages, ...nonSystemMessages]);
  }
}
