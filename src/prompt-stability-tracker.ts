import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type {
  SharedPrefixObservation,
  SharedPrefixTracker,
} from "./types.js";

const HOST_ONLY_MESSAGE_KEYS = new Set([
  "id",
  "sourceRecordId",
  "eventId",
  "messageId",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderOptions(providerOptions: unknown): unknown {
  if (!isRecord(providerOptions)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(providerOptions)
    .filter(([key]) => key !== "contextManagement")
    .map(([key, value]) => [key, normalizeUnknown(value)] as const)
    .filter(([, value]) => value !== undefined);

  return normalizedEntries.length > 0
    ? Object.fromEntries(normalizedEntries)
    : undefined;
}

function normalizeUnknown(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUnknown(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalizedEntries = Object.entries(value)
    .map(([key, entryValue]) => {
      if (key === "providerOptions") {
        return [key, normalizeProviderOptions(entryValue)] as const;
      }

      return [key, normalizeUnknown(entryValue)] as const;
    })
    .filter(([, entryValue]) => entryValue !== undefined);

  return Object.fromEntries(normalizedEntries);
}

function normalizeMessageForSharedPrefix(message: unknown): unknown {
  if (!isRecord(message)) {
    return normalizeUnknown(message);
  }

  const normalizedEntries = Object.entries(message)
    .filter(([key]) => !HOST_ONLY_MESSAGE_KEYS.has(key))
    .map(([key, value]) => {
      if (key === "providerOptions") {
        return [key, normalizeProviderOptions(value)] as const;
      }

      if (key === "content") {
        return [key, normalizeUnknown(value)] as const;
      }

      return [key, normalizeUnknown(value)] as const;
    })
    .filter(([, value]) => value !== undefined);

  return Object.fromEntries(normalizedEntries);
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function fingerprintPrompt(prompt: LanguageModelV3Prompt): string[] {
  return prompt.map((message) => stableSerialize(normalizeMessageForSharedPrefix(message)));
}

class InMemorySharedPrefixTracker implements SharedPrefixTracker {
  private previousFingerprints: string[] | undefined;

  observe(prompt: LanguageModelV3Prompt): SharedPrefixObservation {
    const currentFingerprints = fingerprintPrompt(prompt);
    const previousFingerprints = this.previousFingerprints;

    let sharedPrefixMessageCount = 0;
    if (previousFingerprints) {
      const comparableLength = Math.min(previousFingerprints.length, currentFingerprints.length);
      for (let index = 0; index < comparableLength; index += 1) {
        if (previousFingerprints[index] !== currentFingerprints[index]) {
          break;
        }
        sharedPrefixMessageCount = index + 1;
      }
    }

    this.previousFingerprints = currentFingerprints;

    return {
      sharedPrefixMessageCount,
      lastSharedMessageIndex:
        sharedPrefixMessageCount > 0 ? sharedPrefixMessageCount - 1 : undefined,
      hasSharedPrefix: sharedPrefixMessageCount > 0,
    };
  }
}

export function createSharedPrefixTracker(): SharedPrefixTracker {
  return new InMemorySharedPrefixTracker();
}
