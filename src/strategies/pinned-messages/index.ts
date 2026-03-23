import type { ToolSet } from "ai";
import type {
  ContextManagementStrategy,
  ContextManagementStrategyExecution,
  ContextManagementStrategyState,
  PinnedMessagesStrategyOptions,
  PinnedStore,
  PinnedStoreKey,
} from "../../types.js";
import { createPinToolResultTool } from "./tools/pin-tool-result.js";

const DEFAULT_MAX_PINNED = 10;

function buildPinnedKey(context: { conversationId: string; agentId: string }): PinnedStoreKey {
  return {
    conversationId: context.conversationId,
    agentId: context.agentId,
  };
}

export class PinnedMessagesStrategy implements ContextManagementStrategy {
  readonly name = "pinned-messages";
  private readonly pinnedStore: PinnedStore;
  private readonly maxPinned: number;
  private readonly optionalTools: ToolSet;

  constructor(options: PinnedMessagesStrategyOptions) {
    this.pinnedStore = options.pinnedStore;
    this.maxPinned = options.maxPinned ?? DEFAULT_MAX_PINNED;
    this.optionalTools = {
      pin_tool_result: createPinToolResultTool({
        pinnedStore: this.pinnedStore,
        maxPinned: this.maxPinned,
      }),
    };
  }

  getOptionalTools(): ToolSet {
    return this.optionalTools;
  }

  async apply(state: ContextManagementStrategyState): Promise<ContextManagementStrategyExecution> {
    const key = buildPinnedKey(state.requestContext);
    const pinnedIds = (await this.pinnedStore.get(key)) ?? [];

    if (pinnedIds.length > 0) {
      state.addPinnedToolCallIds(pinnedIds);
    }

    return {
      reason: pinnedIds.length > 0 ? "pinned-tool-results-loaded" : "no-pinned-tool-results",
      payloads: {
        kind: "pinned-messages",
        pinnedToolCallIds: pinnedIds,
        maxPinned: this.maxPinned,
      },
    };
  }
}
