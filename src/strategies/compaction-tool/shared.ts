import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { CompactionAnchor, CompactionEdit } from "../../types.js";

export const COMPACTION_SUMMARY_MESSAGE_TYPE = "compaction-summary";

type AddressableFields = {
  id?: string;
  sourceRecordId?: string;
  eventId?: string;
};

type ContextManagementMetadata = {
  type?: string;
  editId?: string;
  source?: CompactionEdit["source"];
  startAnchor?: CompactionAnchor;
  endAnchor?: CompactionAnchor;
  compactedMessageCount?: number;
};

export type AddressableMessage = LanguageModelV3Message & AddressableFields;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asContextManagementMetadata(message: LanguageModelV3Message): ContextManagementMetadata | undefined {
  const providerOptions = isRecord(message.providerOptions)
    ? message.providerOptions
    : undefined;
  const contextManagement = providerOptions && isRecord(providerOptions.contextManagement)
    ? providerOptions.contextManagement
    : undefined;

  if (!contextManagement) {
    return undefined;
  }

  return contextManagement as ContextManagementMetadata;
}

export function normalizeCompactionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function getMessageTextContent(message: LanguageModelV3Message): string | undefined {
  if (typeof message.content === "string") {
    const normalized = normalizeCompactionText(message.content);
    return normalized.length > 0 ? normalized : undefined;
  }

  const text = message.content
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n");
  const normalized = normalizeCompactionText(text);
  return normalized.length > 0 ? normalized : undefined;
}

export function extractMessageAnchor(message: LanguageModelV3Message): CompactionAnchor | undefined {
  const record = message as AddressableMessage;
  const anchor: CompactionAnchor = {
    ...(typeof record.sourceRecordId === "string" && record.sourceRecordId.length > 0
      ? { sourceRecordId: record.sourceRecordId }
      : {}),
    ...(typeof record.eventId === "string" && record.eventId.length > 0
      ? { eventId: record.eventId }
      : {}),
    ...(typeof record.id === "string" && record.id.length > 0
      ? { messageId: record.id }
      : {}),
  };

  return anchor.sourceRecordId || anchor.eventId || anchor.messageId
    ? anchor
    : undefined;
}

export function isCompactionSummaryMessage(message: LanguageModelV3Message): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  return asContextManagementMetadata(message)?.type === COMPACTION_SUMMARY_MESSAGE_TYPE;
}

export function extractCompactionSummaryRange(message: LanguageModelV3Message): {
  start: CompactionAnchor;
  end: CompactionAnchor;
} | undefined {
  const metadata = asContextManagementMetadata(message);
  if (!metadata || metadata.type !== COMPACTION_SUMMARY_MESSAGE_TYPE) {
    return undefined;
  }

  if (!metadata.startAnchor || !metadata.endAnchor) {
    return undefined;
  }

  return {
    start: metadata.startAnchor,
    end: metadata.endAnchor,
  };
}

export function buildCompactionSummaryMessage(
  edit: CompactionEdit
): Extract<LanguageModelV3Message, { role: "assistant" }> & AddressableFields {
  const startAnchor = {
    ...edit.start,
  };
  const endAnchor = {
    ...edit.end,
  };

  return {
    id: `compaction:${edit.id}`,
    role: "assistant",
    content: [
      {
        type: "text",
        text: edit.replacement,
      },
    ],
    providerOptions: {
      contextManagement: {
        type: COMPACTION_SUMMARY_MESSAGE_TYPE,
        editId: edit.id,
        source: edit.source,
        startAnchor,
        endAnchor,
        compactedMessageCount: edit.compactedMessageCount,
      },
    },
  };
}

export function resolveAnchorIndex(
  prompt: LanguageModelV3Prompt,
  anchor: CompactionAnchor
): number | undefined {
  const resolveBy = (
    getter: (message: AddressableMessage) => string | undefined,
    expected: string | undefined
  ): number | undefined => {
    if (!expected) {
      return undefined;
    }

    const matches = prompt.flatMap((message, index) =>
      getter(message as AddressableMessage) === expected ? [index] : []
    );

    return matches.length === 1 ? matches[0] : undefined;
  };

  return resolveBy((message) => message.sourceRecordId, anchor.sourceRecordId)
    ?? resolveBy((message) => message.eventId, anchor.eventId)
    ?? resolveBy((message) => message.id, anchor.messageId);
}
