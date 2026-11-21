# csv-reader-speed

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/bodropp/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/bodropp/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own `csv-reader 1.0.0`, written for the
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty ($100, top 10).

`solve.js` exports `run(input)`, which returns exactly csv-reader 1.0.0's
answer `{columns, rows, errors}` for every input `{text, header}` — including
its broken-row policy: BOM dropped, stray CRs, quote junk, unterminated
quotes, short and long rows, and the line/row each error belongs to.

Speed comes from jumping between delimiters with `indexOf` (native) and
slicing fields out of the original string instead of building them a
character at a time. A whole record with no quote and no stray CR is one
native `split(',')`; only lines holding a quote or a stray CR fall back to a
field-by-field scan, which still jumps with `indexOf`.

`main.ts` is the kit's driver (unchanged): it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`.
