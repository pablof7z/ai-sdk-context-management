import type { LanguageModelV3Message, SharedV3ProviderOptions } from "@ai-sdk/provider";
import { clonePrompt } from "../../prompt-utils.js";
import { createSharedPrefixTracker } from "../../prompt-stability-tracker.js";
import type {
  AnthropicPromptCachingStrategyOptions,
  ContextManagementStrategy,
  ContextManagementStrategyExecution,
  ContextManagementStrategyState,
} from "../../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withAnthropicSharedPrefixBreakpoint(
  prompt: ReturnType<typeof clonePrompt>,
  lastSharedMessageIndex: number | undefined,
  ttl: "5m" | "1h"
): ReturnType<typeof clonePrompt> {
  if (lastSharedMessageIndex === undefined) {
    return prompt;
  }

  const cloned = clonePrompt(prompt);
  const target = cloned[lastSharedMessageIndex] as (LanguageModelV3Message & {
    providerOptions?: SharedV3ProviderOptions;
  }) | undefined;

  if (!target) {
    return prompt;
  }

  const anthropicOptions = isRecord(target.providerOptions?.anthropic)
    ? target.providerOptions?.anthropic
    : {};

  target.providerOptions = {
    ...(target.providerOptions ?? {}),
    anthropic: {
      ...anthropicOptions,
      cacheControl: { type: "ephemeral", ttl },
    },
  } as SharedV3ProviderOptions;

  return cloned;
}

function isEligibleSharedPrefixMessage(message: LanguageModelV3Message): boolean {
  if (message.role === "system" || message.role === "user") {
    return true;
  }

  if (message.role === "tool") {
    return false;
  }

  return !message.content.some((part) => part.type === "tool-call" || part.type === "tool-result");
}

function resolveEligibleSharedPrefixBreakpoint(
  prompt: readonly LanguageModelV3Message[],
  lastSharedMessageIndex: number | undefined
): number | undefined {
  if (lastSharedMessageIndex === undefined) {
    return undefined;
  }

  for (let index = lastSharedMessageIndex; index >= 0; index -= 1) {
    const message = prompt[index];
    if (message && isEligibleSharedPrefixMessage(message)) {
      return index;
    }
  }

  return undefined;
}

export class AnthropicPromptCachingStrategy implements ContextManagementStrategy {
  readonly name = "anthropic-prompt-caching";
  private readonly ttl: "5m" | "1h";
  private readonly tracker = createSharedPrefixTracker();

  constructor(options: AnthropicPromptCachingStrategyOptions = {}) {
    this.ttl = options.ttl ?? "1h";
  }

  apply(state: ContextManagementStrategyState): ContextManagementStrategyExecution {
    if (state.model?.provider !== "anthropic") {
      return {
        outcome: "skipped",
        reason: "non-anthropic-provider",
        payloads: {
          kind: "anthropic-prompt-caching",
          sharedPrefixMessageCount: 0,
          breakpointApplied: false,
        },
      };
    }

    const observation = this.tracker.observe(state.prompt);
    const lastEligibleSharedMessageIndex = resolveEligibleSharedPrefixBreakpoint(
      state.prompt,
      observation.lastSharedMessageIndex
    );
    const sharedPrefixMessageCount = lastEligibleSharedMessageIndex === undefined
      ? 0
      : lastEligibleSharedMessageIndex + 1;
    const hasSharedPrefix = sharedPrefixMessageCount > 0;

    state.updatePrompt(
      withAnthropicSharedPrefixBreakpoint(
        state.prompt,
        lastEligibleSharedMessageIndex,
        this.ttl
      )
    );

    return {
      outcome: hasSharedPrefix ? "applied" : "skipped",
      reason: hasSharedPrefix
        ? "shared-prefix-breakpoint-applied"
        : "no-shared-prefix",
      payloads: {
        kind: "anthropic-prompt-caching",
        sharedPrefixMessageCount,
        lastSharedMessageIndex: lastEligibleSharedMessageIndex,
        breakpointApplied: hasSharedPrefix,
      },
    };
  }
}
