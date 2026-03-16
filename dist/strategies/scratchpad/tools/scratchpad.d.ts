import type { ScratchpadStore, ScratchpadToolInput, ScratchpadToolResult } from "../../../types.js";
export declare function createScratchpadTool(options: {
    scratchpadStore: ScratchpadStore;
    consumeForcedCall: () => boolean;
}): import("ai").Tool<ScratchpadToolInput, ScratchpadToolResult>;
