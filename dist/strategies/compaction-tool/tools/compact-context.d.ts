import type { CompactionEdit, CompactionToolInput, CompactionToolResult, ContextManagementRequestContext } from "../../../types.js";
export declare function createCompactContextTool(options: {
    queueEdit: (context: ContextManagementRequestContext, edit: CompactionEdit) => true | string;
}): import("ai").Tool<CompactionToolInput, CompactionToolResult>;
