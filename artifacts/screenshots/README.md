# Screenshot evidence

**Captured:** 2026-10-22 from the production build served by FastAPI at `http://127.0.0.1:8000`.
**Browser:** Google Chrome (Playwright `channel: 'chrome'`), one fresh browser instance per page. Final release verification captures.
**Method:** the page was first measured at 1440×900; a new instance was then launched with the viewport
height set to `content height + 60` **before navigation**. The capture is a single viewport — not a
stitched full-page screenshot. Dark captures use `colorScheme: dark` plus the app's persisted theme;
the mobile capture uses a 390 px viewport. No image was retouched or cropped for the evidence set.

| file | pixels | what it shows |
| --- | --- | --- |
| `01-dashboard.png` | 1440×3525 | Dashboard: session brief, rotation map, return surface, leadership, breadth, liquidity, risk, data trust |
| `02-rotation-lab.png` | 1440×3439 | Rotation Lab: map/table, selected sector, 120-session timeline, transitions, axis contract |
| `03-sector-comparison.png` | 1440×1905 | Comparison: 3Y rebased lines, presets, window statistics |
| `04-breadth-lab.png` | 1440×2285 | Breadth: 120-session A/D, participation vs NEPSE, MA bars, sector width |
| `05-liquidity-lab.png` | 1440×2990 | Liquidity: stacked turnover, share donut, turnover/return scatter, concentration |
| `06-risk-lab.png` | 1440×3241 | Risk: risk/return, volatility, 14×14 correlation, table, drawdown/rolling |
| `07-fundamentals-lab.png` | 1440×2477 | Fundamentals: P/E dot plot, ROE/cap bubbles, aggregates, member filings |
| `08-sector-explorer.png` | 1440×3254 | Sector Explorer: price structure, participation, liquidity, risk, filings |
| `09-quantitative-research.png` | 1440×2066 | Research: factor scores/attribution, score table, transition matrix, backtest |
| `10-data-quality.png` | 1440×2834 | Data Quality: coverage, inventory, validation, runs, source register |
| `11-events-research.png` | 1440×1211 | Events: planned coverage and `UNAVAILABLE` source status |
| `12-methodology.png` | 1440×3999 | Methodology: full reference (page is ~3,940 px at this width) |
| `13-dashboard-dark.png` | 1440×900 | Dashboard in dark theme |
| `14-rotation-dark.png` | 1440×900 | Rotation Lab in dark theme |
| `15-dashboard-mobile.png` | 390×844 | Mobile dashboard; no horizontal page overflow |
| `16-not-found.png` | 1440×900 | 404 route |

The screenshot set is intentionally 16 rather than 12–15: the twelve content pages plus dark, mobile and
404 states. There are no exploratory or superseded captures in this directory.

These are the final release-audit captures taken in Chrome against commit `869a9e3`. See
[VISUALIZATION_AUDIT.md](../../docs/VISUALIZATION_AUDIT.md) for the review and
[TESTING_REPORT.md](../../docs/TESTING_REPORT.md) for the browser evidence.
