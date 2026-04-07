export const COMPACTION_SUMMARY_MESSAGE_TYPE = "compaction-summary";
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function asContextManagementMetadata(message) {
    const providerOptions = isRecord(message.providerOptions)
        ? message.providerOptions
        : undefined;
    const contextManagement = providerOptions && isRecord(providerOptions.contextManagement)
        ? providerOptions.contextManagement
        : undefined;
    if (!contextManagement) {
        return undefined;
    }
    return contextManagement;
}
export function normalizeCompactionText(value) {
    return value.replace(/\s+/g, " ").trim();
}
export function getMessageTextContent(message) {
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
export function extractMessageAnchor(message) {
    const record = message;
    const anchor = {
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
export function isCompactionSummaryMessage(message) {
    if (message.role !== "assistant") {
        return false;
    }
    return asContextManagementMetadata(message)?.type === COMPACTION_SUMMARY_MESSAGE_TYPE;
}
export function extractCompactionSummaryRange(message) {
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
export function buildCompactionSummaryMessage(edit) {
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
export function resolveAnchorIndex(prompt, anchor) {
    const resolveBy = (getter, expected) => {
        if (!expected) {
            return undefined;
        }
        const matches = prompt.flatMap((message, index) => getter(message) === expected ? [index] : []);
        return matches.length === 1 ? matches[0] : undefined;
    };
    return resolveBy((message) => message.sourceRecordId, anchor.sourceRecordId)
        ?? resolveBy((message) => message.eventId, anchor.eventId)
        ?? resolveBy((message) => message.id, anchor.messageId);
}
