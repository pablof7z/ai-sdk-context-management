import type {
  LanguageModelV3Message,
  SharedV3ProviderOptions,
} from "@ai-sdk/provider";
import { clonePrompt } from "../../prompt-utils.js";
import { createSharedPrefixTracker } from "../../prompt-stability-tracker.js";
import type {
  AnthropicPromptCachingStrategyOptions,
  ContextManagementStrategy,
  ContextManagementStrategyExecution,
  ContextManagementStrategyState,
} from "../../types.js";

const ANTHROPIC_CLEAR_TOOL_USES_EDIT = {
  type: "clear_tool_uses_20250919",
  trigger: { type: "tool_uses", value: 25 },
  keep: { type: "tool_uses", value: 10 },
  clearAtLeast: { type: "input_tokens", value: 4000 },
  clearToolInputs: true,
  excludeTools: ["delegate", "delegate_followup", "delegate_crossproject"],
};

type ResolvedAnthropicServerToolEditingOptions = {
  enabled: boolean;
  triggerToolUses: number;
  keepToolUses: number;
  clearAtLeastInputTokens: number;
  clearToolInputs: boolean;
  excludeTools: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInteger(value: unknown, fallback: number, minimum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.floor(value))
    : fallback;
}

function normalizeToolList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .flatMap((entry) => (typeof entry === "string" ? [entry.trim()] : []))
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function normalizeAnthropicServerToolEditing(
  options: AnthropicPromptCachingStrategyOptions
): ResolvedAnthropicServerToolEditingOptions {
  const rawServerToolEditing = options.serverToolEditing;
  const rawConfig = isRecord(rawServerToolEditing) ? rawServerToolEditing : {};

  let enabled = options.clearToolUses !== false;
  if (rawServerToolEditing === false) {
    enabled = false;
  } else if (rawServerToolEditing === true) {
    enabled = true;
  } else if (typeof rawConfig.enabled === "boolean") {
    enabled = rawConfig.enabled;
  }

  return {
    enabled,
    triggerToolUses: normalizeInteger(
      rawConfig.triggerToolUses,
      ANTHROPIC_CLEAR_TOOL_USES_EDIT.trigger.value,
      1
    ),
    keepToolUses: normalizeInteger(
      rawConfig.keepToolUses,
      ANTHROPIC_CLEAR_TOOL_USES_EDIT.keep.value,
      0
    ),
    clearAtLeastInputTokens: normalizeInteger(
      rawConfig.clearAtLeastInputTokens,
      ANTHROPIC_CLEAR_TOOL_USES_EDIT.clearAtLeast.value,
      0
    ),
    clearToolInputs: typeof rawConfig.clearToolInputs === "boolean"
      ? rawConfig.clearToolInputs
      : ANTHROPIC_CLEAR_TOOL_USES_EDIT.clearToolInputs,
    excludeTools: normalizeToolList(
      rawConfig.excludeTools,
      ANTHROPIC_CLEAR_TOOL_USES_EDIT.excludeTools
    ),
  };
}

function buildAnthropicClearToolUsesEdit(
  serverToolEditing: ResolvedAnthropicServerToolEditingOptions
) {
  return {
    type: ANTHROPIC_CLEAR_TOOL_USES_EDIT.type,
    trigger: { type: "tool_uses" as const, value: serverToolEditing.triggerToolUses },
    keep: { type: "tool_uses" as const, value: serverToolEditing.keepToolUses },
    clearAtLeast: {
      type: "input_tokens" as const,
      value: serverToolEditing.clearAtLeastInputTokens,
    },
    clearToolInputs: serverToolEditing.clearToolInputs,
    excludeTools: serverToolEditing.excludeTools,
  };
}

function withAnthropicClearToolUses(
  providerOptions: unknown,
  serverToolEditing: ResolvedAnthropicServerToolEditingOptions
): SharedV3ProviderOptions {
  const normalizedProviderOptions = isRecord(providerOptions) ? providerOptions : {};
  const anthropicOptions = isRecord(normalizedProviderOptions.anthropic)
    ? normalizedProviderOptions.anthropic
    : {};
  const contextManagement = isRecord(anthropicOptions.contextManagement)
    ? anthropicOptions.contextManagement
    : {};
  const existingEdits = Array.isArray(contextManagement.edits)
    ? contextManagement.edits
    : [];
  const clearToolUsesEdit = buildAnthropicClearToolUsesEdit(serverToolEditing);
  const hasClearToolUses = existingEdits.some(
    (edit) => isRecord(edit) && edit.type === clearToolUsesEdit.type
  );

  return {
    ...normalizedProviderOptions,
    anthropic: {
      ...anthropicOptions,
      contextManagement: {
        ...contextManagement,
        edits: hasClearToolUses
          ? existingEdits
          : [...existingEdits, clearToolUsesEdit],
      },
    },
  } as SharedV3ProviderOptions;
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
  private readonly serverToolEditing: ResolvedAnthropicServerToolEditingOptions;
  private readonly tracker = createSharedPrefixTracker();

  constructor(options: AnthropicPromptCachingStrategyOptions = {}) {
    this.ttl = options.ttl ?? "1h";
    this.serverToolEditing = normalizeAnthropicServerToolEditing(options);
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
          clearToolUsesEnabled: false,
        },
      };
    }

    if (this.serverToolEditing.enabled) {
      state.updateParams({
        providerOptions: withAnthropicClearToolUses(
          state.params.providerOptions,
          this.serverToolEditing
        ) as ContextManagementStrategyState["params"]["providerOptions"],
      });
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
      outcome: observation.hasSharedPrefix || this.serverToolEditing.enabled ? "applied" : "skipped",
      reason: observation.hasSharedPrefix
        ? "shared-prefix-breakpoint-applied"
        : this.serverToolEditing.enabled
          ? "clear-tool-uses-enabled"
          : "no-shared-prefix",
      payloads: {
        kind: "anthropic-prompt-caching",
        sharedPrefixMessageCount: observation.sharedPrefixMessageCount,
        lastSharedMessageIndex: observation.lastSharedMessageIndex,
        breakpointApplied: observation.hasSharedPrefix,
        clearToolUsesEnabled: this.serverToolEditing.enabled,
      },
    };
  }
}
