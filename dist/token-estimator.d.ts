import type { CalibratingEstimator, PromptTokenEstimator } from "./types.js";
export declare function createDefaultPromptTokenEstimator(): PromptTokenEstimator;
export declare function createCalibratingEstimator(base?: PromptTokenEstimator, options?: {
    alpha?: number;
}): CalibratingEstimator;
