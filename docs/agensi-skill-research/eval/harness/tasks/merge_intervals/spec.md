# merge_intervals(intervals) -> list of (start, end)

Merge overlapping closed integer intervals.

- Input: a list of `(start, end)` tuples in any order. Output: a new list of tuples sorted by start, with no two intervals overlapping or touching.
- Intervals are closed, so intervals that share an endpoint merge: `(1, 3)` and `(3, 5)` become `(1, 5)`. `(1, 2)` and `(3, 4)` stay separate.
- A zero-length interval `(4, 4)` is valid.
- Raises `ValueError` if any interval has `start > end`.
- The input list must not be modified. Empty input returns `[]`.
- The module under test is importable as `impl`.
