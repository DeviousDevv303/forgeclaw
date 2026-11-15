# parse_duration(text) -> int seconds

Parse a duration such as `"1h30m15s"` into total seconds.

- Units: `h` = 3600 s, `m` = 60 s, `s` = 1 s. Each unit is optional but at least one must appear.
- Units must appear in the order h, m, s and at most once each (`"5m1h"` and `"1m2m"` are errors).
- Each unit is preceded by a non-negative base-10 integer using ASCII digits; values are not range-limited (`"90m"` is 5400).
- Raises `ValueError` for: non-string or empty input, a unit with no number, a trailing number with no unit, any other character (including spaces, signs, decimals, uppercase).
- The module under test is importable as `impl`.
