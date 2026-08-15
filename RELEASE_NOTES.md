# Rthoptera Desk 0.4.0

A data-correctness fix in the Excel reader, a rethink of how temperature
evidence is reported, and new ways to summarize song structure.

**If you produced any merged summary with 0.3.1 or earlier, recompute it.**
The reader silently dropped data, and the values it produced are plausible
rather than obviously wrong — which is the kind that reaches a manuscript.

## Empty cells silently blanked the next column

Empty cells are written self-closing (`<c r="B2"/>`). The cell parser matched
attributes greedily, so it swallowed the trailing slash, read the cell as an
*opening* tag, and consumed the following cell whole.

Every column immediately after an empty one was read as blank. In practice:

- `specimen_id` was blank in **every row** of any export where no temperature
  was entered, because `temp_c` sits immediately before it. Summarize then
  fell back to the file name for grouping, so **individual counts and every
  per-specimen statistic were wrong** in those merges.
- `train_period_ms` and `peak_freq_khz` were lost on the last train of each
  motif, where `train_gap_ms` is null by design.
- Several means in the per-file Summary sheet were lost the same way.

Measured on one real 998-row workbook: `specimen_id` blank in all 998 Peaks
rows and all 52 Trains rows, plus five Summary means and a real
`peak_freq_khz` value.

Hardened alongside it: self-closing `<row/>` elements, empty shared strings
(`<si/>`, which shifted every later string index and could rewrite an entire
sheet as someone else's text), header whitespace and byte-order marks, and
duplicate header columns where a blank copy erased a populated one.

## A constant metric scored a perfect temperature fit

r² was reported as **1** when a metric had zero variance. A constant is the
one thing that certainly does not track temperature, yet it outranked every
real thermal response and passed every acceptance test. Zero-variance
responses are now refused outright, as are fits with fewer than three
recordings or no spread in temperature.

## Temperature: evidence is reported, not filtered

Previously a metric had to clear r² ≥ 0.25 *and* p < 0.05 to be used at all.
Below that it was silently discarded — so a recording with no temperature got
no estimate rather than a rough one, and a pooled mean kept its thermal bias
with nothing said about why. At small sample sizes the bar is severe: with
four recordings a response must reach r² ≥ 0.90 to clear p < 0.05.

Fits are now applied wherever one exists, and each is reported with its own
uncertainty:

- **Corrected values** carry the fitted slope, that slope's standard error, r²
  and the number of recordings behind it. A correction that does not reach
  significance says so in place, and is marked as indicative only.
- **Estimated temperatures** for recordings with no reading now combine the
  metrics by inverse-variance weighting rather than by a threshold. A metric
  that predicts temperature poorly has a wide prediction interval and is
  weighted towards nothing, instead of being admitted or rejected by a cutoff
  it happens to sit either side of. The same interval carries an
  extrapolation penalty, so a vote cast outside the calibration range counts
  for less automatically.
- Estimates report a standard error and a 95% confidence interval beside the
  value, plus how many metrics voted and how many of those were individually
  significant.

Two uncertainties are reported for each estimate, because they answer
different questions: the inverse-variance standard error says how precise the
pooled estimate is, while the spread across metrics says how much the metrics
disagree. A small standard error beside a wide spread is the warning case.

## Gaps and syllables can be summarized directly

Two new families of structure selection:

- **Gaps between structures** — the silences as units in their own right,
  named after the pair they separate. `1-2, 3-4, 5-6` (or simply `odd`) on
  "Gaps between trains within each echeme" gives the intra-syllable gaps;
  `even` gives the inter-syllable ones. Selecting peak intervals this way also
  excludes the inter-train jump that `peak_period_ms` carries on each train's
  last peak, which previously inflated any mean taken over that column.
- **Runs of structures (syllables)** — a fixed run of consecutive structures
  measured as one sound, for disyllabic and trisyllabic songs. Duration is the
  **span**, first onset to last offset, so it includes the silence between the
  strokes. Sound, silence and duty cycle are reported separately. Incomplete
  runs are reported as left over rather than counted as short syllables.

Only exact or explicitly weighted aggregations are carried up to a syllable:
counts and excursions are summed, frequencies are averaged weighted by stroke
duration, and extremes are taken as extremes. Columns with no defensible
aggregation are omitted rather than averaged into a number that reads like a
measurement.

## Text report

- Peak frequency and -20 dB bandwidth at train and motif level.
- One line per recording, with its temperature, train count, mean peak rate
  and mean peak frequency. Temperature is a property of the recording, so it
  is stated there rather than on the per-specimen lines.
- Corrected values appear in their own sentence naming the target temperature,
  never interleaved with the observed ones. Square brackets are left free for
  range notation.
- The temperature range is stated up front whether or not the correction is
  in use.

The summary table gains matching N / Mean / SD columns at the target
temperature, and the temperature controls now update the view immediately
instead of only at export time.
