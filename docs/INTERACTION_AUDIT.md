# Interaction Audit

Audit date: 2026-10-22.

| Control | Page | Status | Evidence |
| --- | --- | --- | --- |
| Lookback selector | Rotation Lab | PASS | Updates `/api/rotation?window=` and map/table/timeline. |
| Trail length | Rotation Lab | PASS | Trail query changes path length. |
| Bubble metric | Rotation Lab | PASS | Marker area changes; quadrants unchanged. |
| Sector visibility | Rotation Lab | PASS | Hidden sectors removed from map, table and timeline. |
| Watchlist pin/filter | Rotation Lab | PASS | Pins persist in `localStorage`; filter restricts visible sectors. |
| Clear selection | Rotation Lab | PASS | Removes selected sector and detail panel. |
| Historical scrubber | Rotation Lab | PASS | Uses stored 120-session observations only. |
| Sortable table | Rotation Lab | PASS | Columns sort ascending/descending. |
| Chart zoom/reset | Rotation Lab | PASS | Wheel zoom changes canvas; reset restores exact hash. |
| Thresholds | Rotation Lab | PASS | Range sliders move boundaries. |
| Compare presets/dates/modes/chips | Sector Comparison | PASS | Series and statistics update. |
| Breadth windows/deep dive | Breadth Lab | PASS | 60/120/260 and sector drill-down. |
| Risk sector selection | Risk Lab | PASS | Drawdown and rolling charts update. |
| Fundamentals selection | Fundamentals Lab | PASS | Member table and detail update. |
| Data-quality re-check | Data Quality | PASS | Action completes without errors. |
| Command palette | Layout | PASS | `Meta/Ctrl+K`, filter, Enter. |
| Theme toggle | Layout | PASS | Persisted in `localStorage`. |
| Preferences | Rotation Lab | PASS | Lookback, trail and bubble preferences persist. |
