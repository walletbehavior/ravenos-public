# Mobile chart sizing correction

An Onchain mobile rule capped the complete chart at 180–250 CSS pixels. The embedded chart also needs room for its own toolbar, market legend, timeline and attribution. The existing visibility test passed even when almost no candle area remained. A regression fixture with those controls reproduced only six pixels of plot height at a 390 × 664 viewport.

Mobile provider charts now reserve 400–480 pixels using the stable small-viewport height. Native spot charts reserve 240–320 pixels, and the secondary market facts use compact, consistent label/value rows. Both chart types and the existing single-action ticket stay in normal page flow. Short screens scroll; the plot is not compressed to force the entire ticket above the fold. Provider controls and attribution remain intact, and focus mode remains available.

The browser regression checks a minimum 200-pixel candle area actually visible above mobile navigation at 375 × 650, 390 × 664 and 430 × 740. It also verifies desktop layout, preserved iframe identity and order draft after dismissing a holder overlay, and returning to native Perps charts. The prior visible-iframe assertion alone was insufficient.

This change affects presentation only. It adds no signing step, transaction, provider request, new data source or execution permission. Browser trade tests use fixtures and do not establish a completed production trade. Staging and production receipts establish deployment status.
