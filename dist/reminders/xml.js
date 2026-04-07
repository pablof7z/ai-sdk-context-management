function escapeAttributeValue(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
function formatAttributes(attributes) {
    if (!attributes) {
        return "";
    }
    const entries = Object.entries(attributes).filter(([key, value]) => key.trim() !== "" && value.trim() !== "");
    if (entries.length === 0) {
        return "";
    }
    return ` ${entries
        .map(([key, value]) => `${key}="${escapeAttributeValue(value)}"`)
        .join(" ")}`;
}
function normalizeDescriptor(reminder) {
    const type = reminder.type.trim();
    const content = reminder.content.trim();
    if (!type || !content) {
        return null;
    }
    const attributes = reminder.attributes
        ? Object.fromEntries(Object.entries(reminder.attributes).filter(([key, value]) => key.trim() !== "" && value.trim() !== ""))
        : undefined;
    return {
        type,
        content,
        ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
}
export function wrapInSystemReminder(reminder) {
    const descriptor = normalizeDescriptor(reminder);
    if (!descriptor) {
        return "";
    }
    const attrs = formatAttributes(descriptor.attributes);
    return `<${descriptor.type}${attrs}>${descriptor.content}</${descriptor.type}>`;
}
export function combineSystemReminders(reminders) {
    const lines = reminders
        .map((reminder) => normalizeDescriptor(reminder))
        .filter((reminder) => reminder !== null)
        .map((reminder) => wrapInSystemReminder(reminder))
        .filter((reminder) => reminder.length > 0);
    if (lines.length === 0) {
        return "";
    }
    return `<system-reminders>\n${lines.join("\n")}\n</system-reminders>`;
}
