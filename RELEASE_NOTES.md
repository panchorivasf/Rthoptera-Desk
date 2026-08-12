# Rthoptera Desk 0.3.1

A correctness fix to the temperature features introduced in 0.3.0. If you
used the temperature regression or the estimation of missing temperatures in
0.3.0, those results are worth recomputing.

## Temperature fits now use one observation per recording

Temperature is a property of the **recording** — every train in a file
carries that file's single reading. The fits were built from raw rows, which
counted one measurement many times over: fifty trains from one recording
were treated as fifty independent observations rather than one.

This skewed the two acceptance gates in opposite directions at once.

- **Sample size was inflated**, so the significance test passed almost
  anything. Ten recordings of fifty trains were judged against the critical
  correlation for n = 500.
- **r² was deflated**, because the denominator carried the train-to-train
  scatter within each recording that temperature cannot explain. Genuine
  thermal responses failed the r² ≥ 0.25 floor and were discarded.

Both fits now collapse each recording to one mean per metric before fitting.
In testing against synthetic data with a known 0.5 °C⁻¹ response:

| Case | Before | After |
|---|---|---|
| Real response, 10 recordings × 50 trains | rejected (r² = 0.22) | accepted (r² = 0.94) |
| Only two recordings | **accepted** with n = 100 | correctly refused |
| Pure noise, no response | rejected | rejected |

The slope itself is unchanged when recordings hold similar numbers of rows;
what was wrong was the assessment of the evidence. Where row counts differ
the slope changes too, since a 200-train recording previously carried forty
times the weight of a 5-train one.

Two consequences worth noting:

- Fitting now genuinely requires **three recordings** with temperatures. It
  previously required three *rows*, so a line through two temperatures could
  be accepted.
- The `extrapolated` flag now works. Calibration used row-level extremes
  while prediction fed the line a per-recording mean, so the range check
  compared a mean against a spread it could never reach and almost never
  fired. Both sides now use the same units, which also means
  `calib_value_min` / `calib_value_max` are no longer comparable to the
  values 0.3.0 wrote.

## Position columns excluded from summary statistics

`peak_time`, `train_start`, `train_end`, `motif_start` and `motif_end` record
*where* a structure sits in the recording, not what it sounds like. They were
being averaged into the summary statistics and offered to the temperature
fits as if they were measurements.

Their mean says only when the recorder happened to be started: roll ten
seconds earlier and every one of them shifts while the song is identical. A
lead-in time that drifts across a warming afternoon can even correlate with
temperature without being caused by it, which let it qualify as a
thermometer for estimating missing temperatures.

They remain in the Peak, Train and Motif tables, where they are needed for
locating a row back in the audio and for rebuilding annotations from a saved
table on import.

## Changed columns

| Sheet | Was | Now |
|---|---|---|
| `Temp_Regression` | `n` | `n_recordings`, `n_rows_total` |
| `Temp_Estimated_Detail` | `calib_n` | `calib_n_recordings`, `calib_n_rows` |

The old `n` counted rows, which overstated the evidence behind a fit. The
pair now reports the honest sample size and how much audio stands behind it.

## Other fixes

- The LaTeX and Word convenience columns addressed their mean/sd/min/max by
  spreadsheet column letter, so adding any column to their left would have
  silently repointed them one column over. They now resolve the column from
  the field name when the sheet is written.
- Release builds no longer split their installers across two GitHub releases.
  Each of the four platform jobs was creating the release independently, and
  two of them racing produced two release objects for the same tag — which is
  why v0.3.0 initially published without its Windows and Apple Silicon
  builds. The release is now created once and all four jobs upload into it.
