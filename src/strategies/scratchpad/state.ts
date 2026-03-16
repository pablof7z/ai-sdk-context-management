import type { ScratchpadState } from "../../types.js";

export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

export function normalizeKeepLastMessages(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

export function normalizeEntryMap(
  value: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const normalized = Object.entries(value)
    .map(([key, entryValue]) => {
      if (typeof entryValue !== "string") {
        return undefined;
      }

      const nextKey = key.trim();
      const nextValue = entryValue.trim();

      if (nextKey.length === 0 || nextValue.length === 0) {
        return undefined;
      }

      return [nextKey, nextValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  if (normalized.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalized);
}

export function mergeEntryMaps(
  currentEntries: Record<string, string> | undefined,
  nextEntries: Record<string, string> | undefined
): Record<string, string> | undefined {
  return normalizeEntryMap({
    ...(currentEntries ?? {}),
    ...(nextEntries ?? {}),
  });
}

export function removeEntryKeys(
  entries: Record<string, string> | undefined,
  keys: readonly string[] | undefined
): Record<string, string> | undefined {
  if (!entries || !keys || keys.length === 0) {
    return entries;
  }

  const nextEntries: Record<string, string> = { ...entries };
  for (const key of keys) {
    const normalizedKey = key.trim();
    if (normalizedKey.length > 0) {
      delete nextEntries[normalizedKey];
    }
  }

  return normalizeEntryMap(nextEntries);
}

export function appendToNotes(currentNotes: string, nextNotes: string | undefined): string {
  const trimmed = nextNotes?.trim() ?? "";
  if (trimmed.length === 0) {
    return currentNotes;
  }

  if (currentNotes.length === 0) {
    return trimmed;
  }

  return `${currentNotes}\n\n${trimmed}`;
}

export function countEntryChars(entries: Record<string, string> | undefined): number {
  if (!entries) {
    return 0;
  }

  return Object.entries(entries).reduce(
    (total, [key, value]) => total + key.length + value.length,
    0
  );
}

export function indentMultiline(value: string, prefix = "  "): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function renderScratchpadState(state: ScratchpadState): string[] {
  const lines: string[] = [];
  const entries = state.entries ?? {};
  const entryItems = Object.entries(entries);
  const notes = state.notes.trim();

  if (entryItems.length === 0 && notes.length === 0) {
    lines.push("(empty)");
    return lines;
  }

  for (const [key, value] of entryItems) {
    if (value.includes("\n")) {
      lines.push(`${key}:`);
      lines.push(indentMultiline(value));
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  if (notes.length > 0) {
    if (entryItems.length > 0) {
      lines.push("notes:");
      lines.push(indentMultiline(notes));
    } else {
      lines.push(notes);
    }
  }

  return lines;
}

export function normalizeScratchpadState(
  state: ScratchpadState | undefined,
  agentLabel?: string
): ScratchpadState {
  const entries = normalizeEntryMap(state?.entries);
  return {
    ...(entries ? { entries } : {}),
    notes: state?.notes ?? "",
    keepLastMessages: normalizeKeepLastMessages(state?.keepLastMessages),
    omitToolCallIds: dedupeStrings(state?.omitToolCallIds ?? []),
    ...(typeof state?.updatedAt === "number" ? { updatedAt: state.updatedAt } : {}),
    ...(state?.agentLabel || agentLabel ? { agentLabel: state?.agentLabel ?? agentLabel } : {}),
  };
}
