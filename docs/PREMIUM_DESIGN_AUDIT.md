# Premium Design Audit

Baseline: commit `705e2be`, 12 content pages, 27 chart surfaces, 16 Chrome screenshots.

## Implemented in this phase

- Custom rotational brand mark in `frontend/src/components/Brand.tsx`, SVG favicon, and updated metadata.
- Relative-strength persistence chart on Sector Explorer (20/60/120-session excess return).
- Cap-weighted contribution view on Dashboard with snapshot caveat.
- Reduced-motion-aware ECharts animation and chart `aria-label`s.

## Five most visually damaging issues

1. Brand identity is a generic chart line in a rounded square; there is no ownable mark, favicon system, or metadata identity.
2. The sidebar and top-level hierarchy are functional but visually flat: active state is only a small dot and a raised background, with weak product presence.
3. Dashboard mixes many small panels; the most important sector-rotation map does not dominate the first screen enough.
4. Chart surfaces share one generic treatment; axes, labels, legends and empty states are consistent but visually undifferentiated.
5. Motion is mostly CSS transitions; route changes and chart updates do not have a coherent, purposeful motion system.

## Five highest-value visualization opportunities

1. Rolling relative-strength persistence for a selected sector, using existing index history.
2. Sector contribution to a selected NEPSE move, using verified market-cap snapshots with an explicit caveat.
3. Risk correlation clustering/ordering to make diversification readable.
4. Liquidity concentration trend using verified turnover history.
5. Breadth deterioration signal using existing advance/decline history.

## Constraints

No individual-company pages, no OHLC/candle database, no fabricated data, no paid services, and no changes to verified rotation definitions.
