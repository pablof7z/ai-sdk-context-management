import { createCalibratingEstimator, createDefaultPromptTokenEstimator } from "../index.js";
import { z } from "zod";
import { makePrompt } from "./helpers.js";

describe("createCalibratingEstimator", () => {
  test("factor starts at 1.0 and estimates match base estimator", () => {
    const base = createDefaultPromptTokenEstimator();
    const calibrating = createCalibratingEstimator(base);

    expect(calibrating.calibrationFactor).toBe(1.0);
    expect(calibrating.calibrationSamples).toBe(0);

    const prompt = makePrompt();
    // With factor=1.0, Math.ceil(x * 1.0) = x for integers
    expect(calibrating.estimatePrompt(prompt)).toBe(base.estimatePrompt(prompt));
  });

  test("uses default estimator when no base is provided", () => {
    const calibrating = createCalibratingEstimator();
    const base = createDefaultPromptTokenEstimator();

    const prompt = makePrompt();
    expect(calibrating.estimatePrompt(prompt)).toBe(base.estimatePrompt(prompt));
  });

  test("cold-start uses simple averaging for first 2 samples", () => {
    const calibrating = createCalibratingEstimator();

    // Sample 1: raw=100, actual=150 → idealFactor=1.5
    // factor = 1.0 + (1.5 - 1.0) / 1 = 1.5
    calibrating.reportActualUsage(100, 150);
    expect(calibrating.calibrationFactor).toBeCloseTo(1.5, 5);
    expect(calibrating.calibrationSamples).toBe(1);

    // Sample 2: raw=100, actual=130 → idealFactor=1.3
    // factor = 1.5 + (1.3 - 1.5) / 2 = 1.4
    calibrating.reportActualUsage(100, 130);
    expect(calibrating.calibrationFactor).toBeCloseTo(1.4, 5);
    expect(calibrating.calibrationSamples).toBe(2);
  });

  test("switches to EMA after 2 samples", () => {
    const alpha = 0.3;
    const calibrating = createCalibratingEstimator(undefined, { alpha });

    // Prime with 2 samples to get factor to 1.4
    calibrating.reportActualUsage(100, 150);
    calibrating.reportActualUsage(100, 130);
    expect(calibrating.calibrationFactor).toBeCloseTo(1.4, 5);

    // Sample 3: raw=100, actual=120 → idealFactor=1.2
    // factor = 0.3 * 1.2 + 0.7 * 1.4 = 0.36 + 0.98 = 1.34
    calibrating.reportActualUsage(100, 120);
    expect(calibrating.calibrationFactor).toBeCloseTo(1.34, 5);
    expect(calibrating.calibrationSamples).toBe(3);
  });

  test("factor is clamped to [0.5, 3.0]", () => {
    const calibrating = createCalibratingEstimator();

    // Push factor very high: raw=10, actual=100 → idealFactor=10
    // Cold start: factor = 1.0 + (10 - 1.0) / 1 = 10.0 → clamped to 3.0
    calibrating.reportActualUsage(10, 100);
    expect(calibrating.calibrationFactor).toBe(3.0);

    // Reset with a new instance for low clamping
    const calibrating2 = createCalibratingEstimator();
    // Push factor very low: raw=100, actual=1 → idealFactor=0.01
    // Cold start: factor = 1.0 + (0.01 - 1.0) / 1 = 0.01 → clamped to 0.5
    calibrating2.reportActualUsage(100, 1);
    expect(calibrating2.calibrationFactor).toBe(0.5);
  });

  test("zero and negative inputs are ignored", () => {
    const calibrating = createCalibratingEstimator();

    calibrating.reportActualUsage(0, 100);
    expect(calibrating.calibrationFactor).toBe(1.0);
    expect(calibrating.calibrationSamples).toBe(0);

    calibrating.reportActualUsage(100, 0);
    expect(calibrating.calibrationFactor).toBe(1.0);
    expect(calibrating.calibrationSamples).toBe(0);

    calibrating.reportActualUsage(-50, 100);
    expect(calibrating.calibrationFactor).toBe(1.0);
    expect(calibrating.calibrationSamples).toBe(0);

    calibrating.reportActualUsage(100, -50);
    expect(calibrating.calibrationFactor).toBe(1.0);
    expect(calibrating.calibrationSamples).toBe(0);
  });

  test("converges after ~5 samples with consistent ratio", () => {
    const calibrating = createCalibratingEstimator();
    const targetRatio = 1.25;

    // Feed consistent samples where actual = raw * 1.25
    for (let i = 0; i < 10; i++) {
      calibrating.reportActualUsage(100, 100 * targetRatio);
    }

    // Should have converged close to 1.25
    expect(calibrating.calibrationFactor).toBeCloseTo(targetRatio, 2);
  });

  test("calibrated estimates apply the factor", () => {
    const base = createDefaultPromptTokenEstimator();
    const calibrating = createCalibratingEstimator(base);

    // Set factor to ~1.5 via two consistent samples
    calibrating.reportActualUsage(100, 150);
    calibrating.reportActualUsage(100, 150);
    expect(calibrating.calibrationFactor).toBeCloseTo(1.5, 5);

    const prompt = makePrompt();
    const baseEstimate = base.estimatePrompt(prompt);
    const calibratedEstimate = calibrating.estimatePrompt(prompt);

    expect(calibratedEstimate).toBe(Math.ceil(baseEstimate * calibrating.calibrationFactor));
  });

  test("estimateTools delegates to base and applies factor", () => {
    const base = createDefaultPromptTokenEstimator();
    const calibrating = createCalibratingEstimator(base);

    const tools = {
      search: {
        description: "Search for something",
        inputSchema: z.object({}),
      },
    };

    // Factor at 1.0 - should match base
    expect(calibrating.estimateTools(tools)).toBe(base.estimateTools!(tools));

    // Adjust factor
    calibrating.reportActualUsage(100, 200);
    const factor = calibrating.calibrationFactor;
    expect(calibrating.estimateTools(tools)).toBe(Math.ceil(base.estimateTools!(tools) * factor));
  });

  test("custom alpha is respected", () => {
    const alpha = 0.5;
    const calibrating = createCalibratingEstimator(undefined, { alpha });

    // Prime cold start
    calibrating.reportActualUsage(100, 150);
    calibrating.reportActualUsage(100, 150);
    const factorAfterColdStart = calibrating.calibrationFactor;

    // Sample 3 with EMA using alpha=0.5: idealFactor=1.0
    // factor = 0.5 * 1.0 + 0.5 * factorAfterColdStart
    calibrating.reportActualUsage(100, 100);
    expect(calibrating.calibrationFactor).toBeCloseTo(
      0.5 * 1.0 + 0.5 * factorAfterColdStart,
      5
    );
  });
});
