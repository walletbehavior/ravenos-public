# RavenOS Token Access Thresholds

RavenOS Pro is available through Stripe at `$149/month` or `$999/year`.
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

1. Token balance at or above Founder threshold grants Founder.
2. Active or trialing Stripe subscription grants Pro.
3. Token balance at or above the active Pro threshold grants Pro.
4. Otherwise access resolves to Free.

The token policy is product access only. RavenOS does not use token language to describe price, yield, appreciation, or returns.
