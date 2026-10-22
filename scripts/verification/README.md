# Browser verification scripts

These are the Playwright harnesses used for the reported browser pass. They are reference
harnesses, not a CI suite: they expect the production build to be running at
`http://127.0.0.1:8000` with the ingested warehouse.

```bash
# once, from the repository root (Playwright is intentionally not a runtime dependency)
npm install --no-save playwright
npx playwright install firefox chromium

# Firefox: primary interactions (55), supplemental audit (15), extras (6)
node scripts/verification/firefox-primary.cjs
node scripts/verification/firefox-supplemental.cjs
node scripts/verification/firefox-extras.cjs

# Chrome smoke (36 checks; uses the installed Chrome channel)
node scripts/verification/chrome-smoke.cjs
```

The scripts use real downloads and assert non-empty files, CSV headers/rows, PNG magic bytes and
dimensions. They fail loudly on console/page errors. Screenshots are captured separately by
`artifacts/screenshots/` tooling; these scripts do not write into the evidence directory.

The counts above are the counts in this build (76 Firefox + 36 Chrome = 112 checks). The Firefox scripts deliberately assert exact
labels and counts (for example `13/13 sectors`) so a silent data loss is visible as a failure.
