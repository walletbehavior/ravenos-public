# Memecoins and Perps market sections

RavenOS now has persistent Memecoins, Perps, and Stocks & ETFs sections. Discover, Raven Reads, the market ribbon, the default search universe, Terminal recent markets, and comparison choices follow the active section. All-market search remains an explicit user choice. Exact market selection changes section using instrument identity, never a ticker-name guess; a BONK perpetual stays in Perps.

Memecoin Reads use qualified Raven token evidence. They do not fall back to perpetual reads when token evidence is empty. Perp breadth, funding and open interest remain in Perps; token flow remains on the memecoin side. Working/punishing cohorts follow their structured chain/category identity. Unclassified evidence is excluded from scoped feeds. Stocks & ETFs retain their own section.

The existing context preference stores the section, and links preserve it across navigation and refresh. Changing sections clears incompatible instrument/evidence context. Another browser tab cannot silently replace this tab's active market. Saved markets remain stored across sections and are filtered for display, rather than deleted.

The existing Memecoins/token universe still includes spot reference assets where explicitly requested. This is a market-family boundary, not a claim that every spot token has been classified as a meme. Portfolio holdings and account balances remain cross-chain financial records.

## Solana transaction compatibility

Reviewed the official Helius article published September 5, 2026:
https://www.helius.dev/blog/solana-transaction-versions

The article describes a materially different v1 layout, including a leading version byte, larger transaction capacity, signature relocation, and native compute/priority-fee configuration. This is not safe to handle by relabeling v1 as legacy or merely increasing maxSupportedTransactionVersion.

The existing byte decoder rejects unsupported versions. This release also makes the normalized transaction-inspection helper reject explicit unsupported versions instead of silently labeling them legacy. Supported legacy/v0 behavior and unresolved lookup-table rejection remain intact. No v1 signing or sending is enabled; v1 decoding, RPC history support, simulation and fee-unit proof require a separate compatibility release.

## Validation

- 1,549 Node tests passed, including eight market-section/context cases and two transaction-version inspection cases.
- All 192 distinct affected market/terminal browser tests passed across the main run and focused rechecks. Browser coverage includes desktop/mobile sections, empty and stale evidence, deliberate all-market search, exact pool identity, saved markets, back navigation, chart and terminal regressions.
- No billing, execution fee, treasury, signing, live Copy or live Shielded feature flags change in this release.
