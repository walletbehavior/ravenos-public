# RavenOS Token Access Thresholds

RavenOS Pro is available through Stripe at `$149/month` or `$999/year`.
RavenOS Atlas is a separate high-tier Stripe subscription for macro, regime, breadth, liquidity, and cross-market context.
Future token-holder access is a product-access policy that can grant Pro or Founder access when a configured Solana SPL mint exists and wallet balance checks are enabled.

There is no live RavenOS token at this time. Live market-cap automation is intentionally deferred.

## Policy

Founder access is reserved for high-conviction early supporters:

- Founder: `10,000,000` RavenOS tokens
- Founder unlocks the Founder badge and experimental features.

Pro token-holder access uses a configurable market-cap stage:

- `early`: `1,000,000`
- `growth`: `500,000`
- `mature`: `100,000`

These thresholds exist so token-holder product access remains meaningful relative to paid RavenOS Pro access while still allowing the policy to evolve as RavenOS grows.

## Configuration

- `RAVENOS_TOKEN_SUPPLY=1000000000`
- `RAVENOS_MARKET_CAP_STAGE=early | growth | mature`
- `RAVENOS_PRO_THRESHOLD_EARLY=1000000`
- `RAVENOS_PRO_THRESHOLD_GROWTH=500000`
- `RAVENOS_PRO_THRESHOLD_MATURE=100000`
- `RAVENOS_FOUNDER_THRESHOLD=10000000`

Token access is inactive unless a mint and RPC endpoint are configured.

## Resolver Order

1. Active or trialing Atlas subscription grants Atlas.
2. Token balance at or above Founder threshold grants Founder.
3. Active or trialing Pro subscription grants Pro.
4. Token balance at or above the active Pro threshold grants Pro.
5. Otherwise access resolves to Free.

The token policy is product access only. RavenOS does not use token language to describe price, yield, appreciation, or returns.

## Atlas Configuration

Atlas uses the same subscription resolver and checkout endpoint as Pro, with separate price IDs:

- `STRIPE_ATLAS_MONTHLY_PRICE_ID`
- `STRIPE_ATLAS_YEARLY_PRICE_ID`

Atlas is not granted by Founder or token-holder access. It is intentionally a separate high-level desk product.
