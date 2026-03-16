import type { PinnedStore } from "../../../types.js";
export declare function createPinToolResultTool(options: {
    pinnedStore: PinnedStore;
    maxPinned: number;
}): import("ai").Tool<{
    pin?: string[];
    unpin?: string[];
}, {
    ok: true;
    pinned: string[];
}>;
