# Cache-Friendly Tool Decay

## New Features

Added three options to make tool decay more cache-friendly and practical:

1. **`minTotalSavingsTokens`** - Only decay when savings justify breaking the cache
2. **`excludeToolNames`** - Never decay specific tool types (like `delegate`)
3. **Adjusted `singleToolPressureAnchors`** - Only aggressive for truly huge results (>50k tokens)

## The Cache Problem

**Before:** Individual tool decay based on size broke Anthropic's prompt cache on every request.

**Why?** The shared prefix keeps changing as different tools decay, invalidating cache even when saving minimal tokens.

**Solution:** Only use aggressive single-tool decay for massive results where savings > cache cost.

## New Options

### 1. `minTotalSavingsTokens`

Don't decay unless total savings exceed this threshold.

```typescript
new ToolResultDecayStrategy({
  minTotalSavingsTokens: 10_000,  // Must save 10k+ tokens to decay
})
```

**Effect:** Prevents decay when it would only save a few hundred tokens but break a 50k token cache.

### 2. `excludeToolNames`

Never decay specific tool types, regardless of size or pressure.

```typescript
new ToolResultDecayStrategy({
  excludeToolNames: ['delegate', 'delegate_followup', 'conversation_get'],
})
```

**Use cases:**
- **Delegation tools** - preserve context from other agents
- **Conversation tools** - keep historical context intact
- **Critical tools** - anything the agent needs to reference repeatedly

### 3. Adjusted `singleToolPressureAnchors` Defaults

Now only kicks in for truly massive results:

```typescript
DEFAULT_SINGLE_TOOL_PRESSURE_ANCHORS = [
  { toolTokens: 50_000,  depthFactor: 0.01 },   // < 50k: use global only
  { toolTokens: 100_000, depthFactor: 10 },     // 100k: decay aggressively
  { toolTokens: 500_000, depthFactor: 50 },     // 500k+: decay immediately
]
```

**Effect:**
- Normal files (1-10k tokens): Use global pressure only → consistent decay → cache-friendly ✅
- Huge results (100k+ tokens like JPGs): Decay immediately → saves massive tokens ✅

## Recommended TENEX Config

```typescript
new ToolResultDecayStrategy({
  estimator: managedBudgetProfile.estimator,
  placeholder: ({ toolName, toolCallId }) => buildDecayPlaceholder(toolName, toolCallId),

  // GENTLE global pressure - most files survive 20-50 turns
  pressureAnchors: [
    { toolTokens: 10_000,  depthFactor: 0.05 },  // Early: keep ~16 turns
    { toolTokens: 50_000,  depthFactor: 0.2 },   // Moderate: keep ~4 turns
    { toolTokens: 200_000, depthFactor: 1 },     // Heavy: decay after 1 turn
  ],

  // Single-tool pressure ONLY for huge results
  singleToolPressureAnchors: [
    { toolTokens: 50_000,  depthFactor: 0.01 },  // < 50k: ignore
    { toolTokens: 100_000, depthFactor: 10 },    // 100k: decay now
    { toolTokens: 500_000, depthFactor: 50 },    // 500k: decay immediately
  ],

  // Only decay when savings are meaningful
  minTotalSavingsTokens: 5_000,  // Must save 5k+ tokens

  // Never decay delegation context
  excludeToolNames: ['delegate', 'delegate_followup'],
})
```

## How It Works Together

### Scenario: Agent reads 10 files (5k tokens each)

**Without new features:**
- Each file might decay at different times based on size
- Cache breaks on every turn
- Total savings: ~30k tokens
- Cache re-read cost: ~50k tokens
- **Net loss: 20k tokens** ❌

**With new features:**
- All files < 50k → use global pressure only
- All decay together when global pressure hits threshold
- Cache stays valid until batch decay
- Total savings: ~30k tokens (same)
- Cache re-read: happens once
- **Net gain: ~25k tokens** ✅

### Scenario: Agent reads JPG (200k tokens)

- singleToolDepthFactor = 50 (very aggressive)
- Decays immediately at depth >= 1
- Saves 200k tokens
- Cache breaks but savings >> cache cost
- **Massive win** ✅

### Scenario: Delegate tool returns 8k token result

- Tool name = 'delegate' → excluded
- Never decays regardless of pressure
- Context preserved for follow-up questions
- **Agent can reference delegate work indefinitely** ✅

## Files Changed

- `src/types.ts`: Added `minTotalSavingsTokens`, `excludeToolNames` options and payload fields
- `src/strategies/tool-result-decay/index.ts`:
  - Updated defaults for single-tool anchors (50k threshold)
  - Added excludeToolNames check in all decay loops
  - Calculate totalSavingsTokens and enforce minimum threshold
  - Include in telemetry

## Migration

✅ **Fully backward compatible** - all new options are optional with safe defaults.

Existing code works unchanged. To opt-in:

```typescript
// Before
new ToolResultDecayStrategy({ estimator })

// After - add new options
new ToolResultDecayStrategy({
  estimator,
  minTotalSavingsTokens: 5_000,
  excludeToolNames: ['delegate'],
})
```
