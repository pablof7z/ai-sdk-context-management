import {
  createSharedPrefixTracker,
} from "../index.js";

describe("createSharedPrefixTracker", () => {
  test("returns no shared prefix on first observation", () => {
    const tracker = createSharedPrefixTracker();

    const result = tracker.observe([
      { role: "system", content: "You are helpful." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);

    expect(result).toEqual({
      sharedPrefixMessageCount: 0,
      lastSharedMessageIndex: undefined,
      hasSharedPrefix: false,
    });
  });

  test("returns the shared prefix through an unchanged tail boundary", () => {
    const tracker = createSharedPrefixTracker();

    tracker.observe([
      { role: "system", content: "Stable system prompt" },
      { role: "user", content: [{ type: "text", text: "First request" }] },
      { role: "assistant", content: [{ type: "text", text: "Prior reply" }] },
    ]);

    const result = tracker.observe([
      { role: "system", content: "Stable system prompt" },
      { role: "user", content: [{ type: "text", text: "First request" }] },
      { role: "assistant", content: [{ type: "text", text: "New reply" }] },
    ]);

    expect(result).toEqual({
      sharedPrefixMessageCount: 2,
      lastSharedMessageIndex: 1,
      hasSharedPrefix: true,
    });
  });

  test("uses the shorter prompt when all available messages still match", () => {
    const tracker = createSharedPrefixTracker();

    tracker.observe([
      { role: "system", content: "Stable system prompt" },
      { role: "user", content: [{ type: "text", text: "A" }] },
      { role: "assistant", content: [{ type: "text", text: "B" }] },
    ]);

    const result = tracker.observe([
      { role: "system", content: "Stable system prompt" },
      { role: "user", content: [{ type: "text", text: "A" }] },
    ]);

    expect(result).toEqual({
      sharedPrefixMessageCount: 2,
      lastSharedMessageIndex: 1,
      hasSharedPrefix: true,
    });
  });

  test("breaks the prefix when message content changes", () => {
    const tracker = createSharedPrefixTracker();

    tracker.observe([
      { role: "system", content: "Stable system prompt" },
      { role: "user", content: [{ type: "text", text: "A" }] },
    ]);

    const result = tracker.observe([
      { role: "system", content: "Stable system prompt updated" },
      { role: "user", content: [{ type: "text", text: "A" }] },
    ]);

    expect(result).toEqual({
      sharedPrefixMessageCount: 0,
      lastSharedMessageIndex: undefined,
      hasSharedPrefix: false,
    });
  });

  test("breaks the prefix when message provider options change", () => {
    const tracker = createSharedPrefixTracker();

    tracker.observe([
      {
        role: "system",
        content: "Stable system prompt",
        providerOptions: {
          anthropic: {
            cacheControl: { type: "ephemeral", ttl: "1h" },
          },
        },
      },
      { role: "user", content: [{ type: "text", text: "A" }] },
    ]);

    const result = tracker.observe([
      {
        role: "system",
        content: "Stable system prompt",
        providerOptions: {
          anthropic: {
            cacheControl: { type: "ephemeral", ttl: "5m" },
          },
        },
      },
      { role: "user", content: [{ type: "text", text: "A" }] },
    ]);

    expect(result).toEqual({
      sharedPrefixMessageCount: 0,
      lastSharedMessageIndex: undefined,
      hasSharedPrefix: false,
    });
  });
});
