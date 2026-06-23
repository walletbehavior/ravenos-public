# RavenOS Market-Agnostic Architecture Review

Date: 2026-06-23

## Scope

Current supported domains:

- Crypto spot markets
- Perpetual futures markets

Planned domains:

- Equities
- ETFs
- Options
- Macro data

Goal: keep RavenOS market-agnostic while preserving Solana wallet and SPL token access for launch.

## Findings

### 1. Product UI still contains crypto-specific labels in places where generic market language is better

Examples:

- `Token Holder Access`
- `Chain Posture`
- `Wallet Behavior Feed`
- token detail route `/token/`
- chart labels such as `chain/token rows`

These are acceptable when describing Solana access or crypto-specific modules, but should not be the default vocabulary for RavenOS product navigation.

Recommended language:

- `Token Holder Access` -> `SPL Access Gate` or `Access Holder`
- `Chain Posture` -> `Venue / Network Posture`
- `Wallet Behavior Feed` -> `Participant Behavior Feed`
- `Token Detail` -> `Instrument Detail`
- `Chain` -> `Venue`, `Network`, or `Market`, depending on context

### 2. Access layer is intentionally Solana-native and should stay isolated

Files:

- `lib/ravenos_access.mjs`
- `lib/solana_wallet_auth.mjs`
- `public/ravenos-access.js`

Crypto-specific assumptions here are appropriate:

- Phantom
- Solflare
- Backpack
- SPL token balance checks
- Solana signature verification

Recommendation: keep this isolated under an access-provider boundary so future EVM, SSO, or enterprise auth does not leak into product modules.

### 3. Data modules should use generic market/instrument concepts

Current UI mock data already moves toward:

- `asset`
- `market`
- `instrument`
- `participant`
- `flow`
- `posture`

The Flow Terminal should become the reference model for future product modules.

### 4. Routing should be renamed over time

Current routes:

- `/token/`
- `/pro/`
- `/terminal/`

Recommended future routes:

- `/instrument/`
- `/terminal/`
- `/markets/`
- `/research/`
- `/account/`

Keep `/token/` as a compatibility alias if live users or marketing links exist.

## Refactor Plan

### Phase 1: Vocabulary and UI boundary

Replace generic product copy with market-agnostic language:

- `token` -> `asset` or `instrument`, except SPL access copy
- `chain` -> `venue`, `network`, or `market`, depending on meaning
- `wallet` -> `participant`, except wallet connection/access controls
- `smart wallet` -> `informed participant` or `participant cluster`, except crypto-specific analysis pages

### Phase 2: Type boundaries

Introduce shared domain types under:

```text
lib/markets/
```

Recommended files:

```text
lib/markets/marketTypes.ts
lib/markets/mockMarketData.ts
lib/markets/accessTypes.ts
```

### Phase 3: Component boundaries

Use market-agnostic components:

```text
components/terminal/FlowTerminal.tsx
components/terminal/FlowTable.tsx
components/terminal/InstrumentSelector.tsx
components/terminal/IntelligencePanel.tsx
components/charts/RavenPriceChart.tsx
components/access/FeatureGate.tsx
components/access/WalletAccessPanel.tsx
```

Crypto-specific access components should stay under:

```text
components/access/solana/
```

### Phase 4: Data adapters

Create adapters for each domain:

```text
lib/adapters/cryptoSpotAdapter.ts
lib/adapters/perpetualsAdapter.ts
lib/adapters/equitiesAdapter.ts
lib/adapters/etfAdapter.ts
lib/adapters/optionsAdapter.ts
lib/adapters/macroAdapter.ts
```

Adapters should normalize incoming data into the same market/instrument interfaces.

## Proposed Interfaces

```ts
export type MarketDomain =
  | "crypto_spot"
  | "perpetual_futures"
  | "equity"
  | "etf"
  | "option"
  | "macro";

export type Venue = {
  id: string;
  name: string;
  domain: MarketDomain;
  region?: string;
  metadata?: Record<string, unknown>;
};

export type Instrument = {
  id: string;
  symbol: string;
  name: string;
  domain: MarketDomain;
  venueId?: string;
  baseAsset?: string;
  quoteAsset?: string;
  expiry?: string;
  strike?: number;
  optionType?: "call" | "put";
  metadata?: Record<string, unknown>;
};

export type FlowSnapshot = {
  instrumentId: string;
  market: string;
  venue?: string;
  flowScore: number;
  attentionVelocity: number;
  participantActivity: "low" | "medium" | "high";
  liquidityPosture: string;
  riskRating: "stable" | "watch" | "elevated";
  lastUpdated: string;
  metadata?: Record<string, unknown>;
};

export type ParticipantSignal = {
  instrumentId: string;
  participantType: "wallet" | "fund" | "market_maker" | "retail_cluster" | "unknown";
  activity: string;
  concentration: string;
  posture: string;
  observedAt: string;
  metadata?: Record<string, unknown>;
};

export type AccessTier = "free" | "pro" | "founder";

export type AccessSource =
  | "free"
  | "subscription"
  | "solana_spl_token"
  | "founder_solana_spl_token";
```

## Recommended Component Structure

```text
public/
  terminal/
    index.html
  pricing/
    index.html
  upgrade/
    index.html
  account/
    index.html
  instrument/
    index.html

components/
  access/
    FeatureGate.tsx
    AccessProvider.tsx
    solana/
      SolanaWalletButton.tsx
      SolanaAccessPanel.tsx
  charts/
    RavenPriceChart.tsx
  terminal/
    FlowTerminal.tsx
    FlowTable.tsx
    InstrumentSelector.tsx
    IntelligencePanel.tsx

lib/
  markets/
    marketTypes.ts
    marketDataAdapter.ts
    mockMarketData.ts
  access/
    accessResolver.ts
    stripeAccess.ts
    solanaAccess.ts
```

## Rules Going Forward

Use crypto-specific terms only when they are technically required:

- wallet connection
- SPL token access
- Solana RPC
- chain/network metrics

Use market-agnostic terms everywhere else:

- market
- asset
- instrument
- venue
- participant
- flow
- posture
- risk
- liquidity

This keeps RavenOS positioned as a market intelligence platform rather than a crypto-only dashboard.
