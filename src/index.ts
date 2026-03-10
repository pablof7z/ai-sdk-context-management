export { contextCompression } from "./context-compression.js";
export { createTranscript, defaultTranscriptRenderer } from "./transcript.js";
export { applySegments, validateSegments, buildSummaryMessage } from "./segments.js";
export {
  buildDefaultSegmentPrompt,
  createSegmentGenerator,
  DEFAULT_SEGMENT_PROMPT_TEMPLATE,
} from "./segment-generator.js";
export { defaultToolPolicy } from "./rule-based-compressor.js";
export { createDefaultEstimator } from "./token-estimator.js";
export { createCompressionCache, hashMessages, hashValue } from "./cache.js";

export type {
  CompressionCache,
  CompressionModification,
  CompressionSegment,
  ContextCompressionConfig,
  ContextCompressionDebugInfo,
  ContextCompressionMessage,
  ContextCompressionResult,
  ContextCompressionStats,
  ContextEntryType,
  ContextMessage,
  ContextRole,
  SegmentGenerationInput,
  SegmentGenerator,
  SegmentStore,
  SegmentValidationOptions,
  TokenEstimator,
  ToolEntryPolicyDecision,
  ToolEntryType,
  ToolOutputPolicy,
  ToolPolicy,
  ToolPolicyContext,
  ToolPolicyDecision,
  ToolPolicyEntryContext,
  TranscriptRenderOptions,
  TranscriptRenderResult,
  TranscriptRenderer,
  ValidationResult,
} from "./types.js";

export type { CreateSegmentGeneratorConfig } from "./segment-generator.js";
