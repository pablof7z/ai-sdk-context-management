import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { CompactionAnchor, CompactionEdit } from "../../types.js";
export declare const COMPACTION_SUMMARY_MESSAGE_TYPE = "compaction-summary";
type AddressableFields = {
    id?: string;
    sourceRecordId?: string;
    eventId?: string;
};
export type AddressableMessage = LanguageModelV3Message & AddressableFields;
export declare function normalizeCompactionText(value: string): string;
export declare function getMessageTextContent(message: LanguageModelV3Message): string | undefined;
export declare function extractMessageAnchor(message: LanguageModelV3Message): CompactionAnchor | undefined;
export declare function isCompactionSummaryMessage(message: LanguageModelV3Message): boolean;
export declare function extractCompactionSummaryRange(message: LanguageModelV3Message): {
    start: CompactionAnchor;
    end: CompactionAnchor;
} | undefined;
export declare function buildCompactionSummaryMessage(edit: CompactionEdit): Extract<LanguageModelV3Message, {
    role: "assistant";
}> & AddressableFields;
export declare function resolveAnchorIndex(prompt: LanguageModelV3Prompt, anchor: CompactionAnchor): number | undefined;
export {};
