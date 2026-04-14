import { estimateBudgetProfileTokens, normalizeContextBudgetProfile, } from "../../context-budget-profile.js";
import { appendReminderToLatestUserMessage, canAppendReminderToLatestUserMessage, buildContextManagementSystemMessage, buildContextManagementUserOverlayMessage, clonePrompt, } from "../../prompt-utils.js";
import { combineSystemReminders } from "../../reminders/xml.js";
const DEFAULT_WARNING_THRESHOLD_RATIO = 0.7;
const DEFAULT_OVERLAY_TYPE = "system-reminders";
const VALID_REMINDER_PLACEMENTS = [
    "overlay-user",
    "latest-user-append",
    "fallback-system",
];
const CONTEXT_WINDOW_STATUS_THRESHOLD_PERCENT = 50;
function stableSerialize(value) {
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
        const entries = Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(String(value));
}
function snapshotsEqual(left, right) {
    return stableSerialize(left) === stableSerialize(right);
}
function cloneState(state) {
    return structuredClone(state);
}
function createEmptyReminderState() {
    return {
        providers: {},
        deferred: [],
    };
}
class InMemoryReminderStateStore {
    stateByKey = new Map();
    get(key) {
        const state = this.stateByKey.get(`${key.conversationId}:${key.agentId}`);
        return state ? cloneState(state) : undefined;
    }
    set(key, state) {
        this.stateByKey.set(`${key.conversationId}:${key.agentId}`, cloneState(state));
    }
}
function toDescriptor(reminder) {
    return {
        type: reminder.kind,
        content: reminder.content,
        ...(reminder.attributes ? { attributes: reminder.attributes } : {}),
        ...(reminder.persistInHistory !== undefined
            ? { persistInHistory: reminder.persistInHistory }
            : {}),
    };
}
function buildStatefulReminderStateKey(namespace, type) {
    return `__${namespace}:${type}`;
}
function validateReminderPlacement(placement, source) {
    switch (placement) {
        case "overlay-user":
        case "latest-user-append":
        case "fallback-system":
            return placement;
        default:
            throw new Error(`Unsupported reminder placement for ${source}: ${JSON.stringify(placement)}. `
                + `Supported placements are ${VALID_REMINDER_PLACEMENTS.map((value) => `"${value}"`).join(", ")}.`);
    }
}
function insertSystemMessageAfterLeadingSystemMessages(prompt, content, placement) {
    if (content.length === 0) {
        return prompt;
    }
    const cloned = clonePrompt(prompt);
    let insertIndex = 0;
    while (insertIndex < cloned.length && cloned[insertIndex]?.role === "system") {
        insertIndex += 1;
    }
    cloned.splice(insertIndex, 0, buildContextManagementSystemMessage(content, {
        type: "reminder",
        placement,
    }));
    return cloned;
}
function buildContextUtilizationReminder(options) {
    const { currentTokens, warningThresholdTokens, utilizationPercent, mode, budgetLabel, budgetDescription, } = options;
    const lines = [
        `[Context utilization: ~${utilizationPercent}% of ${budgetLabel}]`,
        `Current ${budgetLabel} tokens: ~${currentTokens}. Warning threshold: ~${warningThresholdTokens}.`,
    ];
    if (budgetDescription) {
        lines.push(budgetDescription);
    }
    if (mode === "scratchpad") {
        lines.push(`Your ${budgetLabel} is getting tight. scratchpad(...) is available for context compaction:`);
        lines.push("- setEntries or replaceEntries update persisted scratchpad state");
        lines.push("- preserveTurns keeps only the head and tail turns around the pruning point");
    }
    else {
        lines.push(`Your ${budgetLabel} is getting tight. Trim or summarize stale context before continuing.`);
    }
    lines.push("[/Context utilization]");
    return lines.join("\n");
}
function formatNumber(value) {
    return value.toLocaleString("en-US");
}
function computePercent(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return 0;
    }
    return (numerator / denominator) * 100;
}
function buildContextWindowStatusReminder(options) {
    const percent = Math.round(computePercent(options.inputTokens, options.rawContextWindow));
    return `Provider-reported last request window: ${percent}% (${formatNumber(options.inputTokens)}/${formatNumber(options.rawContextWindow)} tokens).`;
}
function buildProviderContext(state) {
    return {
        data: state.reminderData,
        prompt: state.prompt,
        requestContext: state.requestContext,
        model: state.model,
        tools: state.params.tools,
    };
}
function resolvePlacement(providerContext, type, defaultPlacement, builtIn, placementPolicy) {
    if (!placementPolicy) {
        return defaultPlacement;
    }
    return placementPolicy({
        ...providerContext,
        type,
        defaultPlacement,
        builtIn,
    });
}
export class RemindersStrategy {
    name = "reminders";
    stateStore;
    providers;
    placementPolicy;
    contextUtilization;
    contextWindowStatus;
    overlayType;
    constructor(options = {}) {
        this.stateStore = options.stateStore ?? new InMemoryReminderStateStore();
        this.providers = [...(options.providers ?? [])];
        this.placementPolicy = options.placementPolicy;
        this.overlayType = options.overlayType ?? DEFAULT_OVERLAY_TYPE;
        if (options.contextUtilization !== false && options.contextUtilization) {
            this.contextUtilization = {
                budgetProfile: normalizeContextBudgetProfile(options.contextUtilization.budgetProfile),
                warningThresholdRatio: Math.min(1, Math.max(0, options.contextUtilization.warningThresholdRatio ?? DEFAULT_WARNING_THRESHOLD_RATIO)),
                mode: options.contextUtilization.mode ?? "generic",
                placement: validateReminderPlacement(options.contextUtilization.placement ?? "latest-user-append", "contextUtilization"),
            };
        }
        if (options.contextWindowStatus !== false && options.contextWindowStatus) {
            this.contextWindowStatus = {
                getContextWindow: options.contextWindowStatus.getContextWindow,
                placement: validateReminderPlacement(options.contextWindowStatus.placement ?? "latest-user-append", "contextWindowStatus"),
            };
        }
    }
    appendOverlayMessages(state, prompt, overlays) {
        if (overlays.length === 0) {
            return prompt;
        }
        const groups = [
            {
                persistInHistory: true,
                reminders: overlays.filter((descriptor) => descriptor.persistInHistory !== false),
            },
            {
                persistInHistory: false,
                reminders: overlays.filter((descriptor) => descriptor.persistInHistory === false),
            },
        ].filter((group) => group.reminders.length > 0);
        let nextPrompt = clonePrompt(prompt);
        for (const group of groups) {
            const overlayXml = combineSystemReminders(group.reminders);
            if (overlayXml.length === 0) {
                continue;
            }
            const overlayMessage = buildContextManagementUserOverlayMessage(overlayXml, {
                type: "reminder-overlay",
                overlayType: this.overlayType,
            });
            nextPrompt = [...nextPrompt, overlayMessage];
            state.addRuntimeOverlay({
                overlayType: this.overlayType,
                message: overlayMessage,
                persistInHistory: group.persistInHistory,
            });
        }
        return nextPrompt;
    }
    async loadReminderState(key) {
        return cloneState(await this.stateStore.get(key) ?? createEmptyReminderState());
    }
    async saveReminderState(key, state) {
        await this.stateStore.set(key, cloneState(state));
    }
    evaluateStatefulDescriptor(options) {
        const { reminderState, namespace, descriptor } = options;
        const fullInterval = Math.max(1, options.fullInterval ?? 1);
        const stateKey = buildStatefulReminderStateKey(namespace, descriptor.type);
        const previous = reminderState.providers[stateKey];
        if (!previous || previous.turnsSinceFullState >= fullInterval) {
            reminderState.providers[stateKey] = {
                snapshot: structuredClone(descriptor),
                turnsSinceFullState: 0,
            };
            return descriptor;
        }
        if (snapshotsEqual(previous.snapshot, descriptor)) {
            reminderState.providers[stateKey] = {
                snapshot: structuredClone(descriptor),
                turnsSinceFullState: previous.turnsSinceFullState + 1,
            };
            return null;
        }
        reminderState.providers[stateKey] = {
            snapshot: structuredClone(descriptor),
            turnsSinceFullState: 0,
        };
        return descriptor;
    }
    evaluateContextUtilization(state) {
        if (!this.contextUtilization) {
            return [];
        }
        const currentTokens = estimateBudgetProfileTokens(this.contextUtilization.budgetProfile, state.prompt, state.params.tools);
        const warningThresholdTokens = Math.floor(this.contextUtilization.budgetProfile.tokenBudget * this.contextUtilization.warningThresholdRatio);
        if (currentTokens < warningThresholdTokens) {
            return [];
        }
        const utilizationPercent = Math.round((currentTokens / this.contextUtilization.budgetProfile.tokenBudget) * 100);
        return [{
                descriptor: {
                    type: "context-utilization",
                    content: buildContextUtilizationReminder({
                        currentTokens,
                        warningThresholdTokens,
                        utilizationPercent,
                        mode: this.contextUtilization.mode,
                        budgetLabel: this.contextUtilization.budgetProfile.label,
                        budgetDescription: this.contextUtilization.budgetProfile.description,
                    }),
                },
                placement: this.contextUtilization.placement,
            }];
    }
    evaluateContextWindowStatus(state) {
        if (!this.contextWindowStatus) {
            return [];
        }
        const inputTokens = state.lastReportedModelInputTokens;
        const rawContextWindow = this.contextWindowStatus.getContextWindow?.({
            model: state.model,
            requestContext: state.requestContext,
        });
        if (inputTokens === undefined || rawContextWindow === undefined) {
            return [];
        }
        const rawContextWindowExactPercent = computePercent(inputTokens, rawContextWindow);
        if (rawContextWindowExactPercent <= CONTEXT_WINDOW_STATUS_THRESHOLD_PERCENT) {
            return [];
        }
        return [{
                descriptor: {
                    type: "context-window-status",
                    content: buildContextWindowStatusReminder({
                        inputTokens,
                        rawContextWindow,
                    }),
                },
                placement: this.contextWindowStatus.placement,
            }];
    }
    async apply(state) {
        const storeKey = {
            conversationId: state.requestContext.conversationId,
            agentId: state.requestContext.agentId,
        };
        const reminderState = await this.loadReminderState(storeKey);
        const providerContext = buildProviderContext(state);
        const promotedDeferred = reminderState.deferred.map((reminder) => ({
            ...reminder,
            disposition: undefined,
        }));
        reminderState.deferred = [];
        const overlayReminders = [];
        const latestUserReminders = [];
        const fallbackSystemReminders = [];
        const reminderTypes = new Set();
        const enqueueDescriptor = (descriptor, placement) => {
            if (descriptor.content.trim().length === 0 || descriptor.type.trim().length === 0) {
                return;
            }
            reminderTypes.add(descriptor.type);
            switch (placement) {
                case "overlay-user":
                    overlayReminders.push(descriptor);
                    break;
                case "fallback-system":
                    fallbackSystemReminders.push(descriptor);
                    break;
                case "latest-user-append":
                default:
                    latestUserReminders.push(descriptor);
                    break;
            }
        };
        for (const reminder of [...promotedDeferred, ...state.consumeReminderQueue()]) {
            if (reminder.disposition === "defer") {
                reminderState.deferred.push({ ...reminder });
                continue;
            }
            const placement = validateReminderPlacement(reminder.placement ?? "latest-user-append", `emitted reminder "${reminder.kind}"`);
            const descriptor = toDescriptor(reminder);
            const renderedDescriptor = reminder.deliveryMode === "stateful"
                ? this.evaluateStatefulDescriptor({
                    reminderState,
                    namespace: "emitted",
                    descriptor,
                })
                : descriptor;
            if (!renderedDescriptor) {
                continue;
            }
            enqueueDescriptor(renderedDescriptor, placement);
        }
        const builtInReminders = [
            ...this.evaluateContextUtilization(state),
            ...this.evaluateContextWindowStatus(state),
        ];
        for (const builtInReminder of builtInReminders) {
            const placement = validateReminderPlacement(resolvePlacement(providerContext, builtInReminder.descriptor.type, builtInReminder.placement, true, this.placementPolicy), `built-in reminder "${builtInReminder.descriptor.type}"`);
            const renderedDescriptor = this.evaluateStatefulDescriptor({
                reminderState,
                namespace: "built-in",
                descriptor: builtInReminder.descriptor,
            });
            if (!renderedDescriptor) {
                continue;
            }
            enqueueDescriptor(renderedDescriptor, placement);
        }
        for (const provider of this.providers) {
            const defaultPlacement = validateReminderPlacement(typeof provider.placement === "function"
                ? provider.placement(providerContext)
                : provider.placement ?? "overlay-user", `provider "${provider.type}" default placement`);
            const placement = validateReminderPlacement(resolvePlacement(providerContext, provider.type, defaultPlacement, false, this.placementPolicy), `provider "${provider.type}"`);
            const currentSnapshot = await provider.snapshot(providerContext.data, providerContext);
            const previous = reminderState.providers[provider.type];
            const fullInterval = Math.max(1, provider.fullInterval ?? 1);
            let rendered = null;
            let nextTurnsSinceFullState = previous?.turnsSinceFullState ?? 0;
            if (!previous || previous.turnsSinceFullState >= fullInterval) {
                rendered = await provider.renderFull(currentSnapshot, providerContext.data, providerContext);
                nextTurnsSinceFullState = 0;
            }
            else {
                const deltaResult = provider.renderDelta
                    ? await provider.renderDelta(previous.snapshot, currentSnapshot, providerContext.data, providerContext)
                    : snapshotsEqual(previous.snapshot, currentSnapshot)
                        ? null
                        : "full";
                if (deltaResult === "full") {
                    rendered = await provider.renderFull(currentSnapshot, providerContext.data, providerContext);
                    nextTurnsSinceFullState = 0;
                }
                else if (deltaResult) {
                    rendered = deltaResult;
                    nextTurnsSinceFullState = previous.turnsSinceFullState + 1;
                }
                else {
                    nextTurnsSinceFullState = previous.turnsSinceFullState + 1;
                }
            }
            reminderState.providers[provider.type] = {
                snapshot: structuredClone(currentSnapshot),
                turnsSinceFullState: nextTurnsSinceFullState,
            };
            if (!rendered) {
                continue;
            }
            enqueueDescriptor(rendered, placement);
        }
        await this.saveReminderState(storeKey, reminderState);
        let nextPrompt = clonePrompt(state.prompt);
        const fallbackSystemXml = combineSystemReminders(fallbackSystemReminders);
        if (fallbackSystemXml.length > 0) {
            nextPrompt = insertSystemMessageAfterLeadingSystemMessages(nextPrompt, fallbackSystemXml, "fallback-system");
        }
        const latestUserXml = combineSystemReminders(latestUserReminders);
        if (latestUserXml.length > 0) {
            if (canAppendReminderToLatestUserMessage(nextPrompt)) {
                nextPrompt = appendReminderToLatestUserMessage(nextPrompt, latestUserXml);
            }
            else if (latestUserReminders.length > 0) {
                nextPrompt = this.appendOverlayMessages(state, nextPrompt, latestUserReminders);
            }
        }
        nextPrompt = this.appendOverlayMessages(state, nextPrompt, overlayReminders);
        state.updatePrompt(nextPrompt);
        const emittedCount = overlayReminders.length
            + latestUserReminders.length
            + fallbackSystemReminders.length;
        return {
            outcome: emittedCount > 0 ? "applied" : "skipped",
            reason: emittedCount > 0 ? "reminders-applied" : "no-reminders",
            payloads: {
                kind: "reminders",
                providerCount: this.providers.length,
                builtInCount: builtInReminders.length,
                emittedCount,
                deferredCount: reminderState.deferred.length,
                overlayCount: overlayReminders.length,
                latestUserAppendCount: latestUserReminders.length,
                fallbackSystemCount: fallbackSystemReminders.length,
                reminderTypes: [...reminderTypes],
            },
        };
    }
}
