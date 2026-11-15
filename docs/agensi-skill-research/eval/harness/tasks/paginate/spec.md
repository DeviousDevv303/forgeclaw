# paginate(total_items, page, per_page) -> (start, end)

Return the half-open index range `[start, end)` of the items on a page.

- `page` is 1-based: page 1 starts at index 0.
- `start = (page - 1) * per_page`, `end = start + per_page`, both capped at `total_items`.
- A page past the end returns `(total_items, total_items)`.
- Raises `ValueError` if `total_items < 0`, `page < 1`, or `per_page < 1`.
- All arguments are ints. The module under test is importable as `impl`.
