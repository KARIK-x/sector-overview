# Sector Rotation Methodology

For sector `s` and lookback `h` trading sessions:

```
A_s(t,h) = I_s(t) / I_s(t-h) - 1
A_m(t,h) = I_m(t) / I_m(t-h) - 1
R_s(t,h) = A_s(t,h) - A_m(t,h)
```

`I_s` is the sector sub-index close. `I_m` is the NEPSE index close. `h` is a number of observed
trading sessions, not calendar days. The sector and market series are aligned on their common observed
dates before the calculation.

Quadrants at the default zero thresholds:

- WINNING: `A_s > 0` and `R_s > 0`
- ADVANCING: `A_s <= 0` and `R_s > 0`
- LOSING: `A_s > 0` and `R_s <= 0`
- LAGGING: `A_s <= 0` and `R_s <= 0`

The relative-strength ratio is reported separately:

```
RS ratio = (I_s(t) / I_s(t-h)) / (I_m(t) / I_m(t-h))
```

Trails connect successive rolling-lookback observations. They are not the sector price series.
