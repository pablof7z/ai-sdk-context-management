import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type {
  SharedPrefixObservation,
  SharedPrefixTracker,
} from "./types.js";

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
  return prompt.map((message) => stableSerialize(message));
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
