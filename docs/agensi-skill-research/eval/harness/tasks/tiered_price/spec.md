# tiered_price(quantity, unit_cents) -> int cents

Total price in integer cents after a volume discount.

- Undiscounted total is `quantity * unit_cents`.
- Discount tier by quantity: 0-9 items 0%, 10-49 items 5%, 50 or more items 10%.
- The discount amount is the percentage of the total, rounded half up to a whole cent; the result is total minus discount.
- Raises `ValueError` if `quantity < 0` or `unit_cents < 0`. Zero quantity or zero price returns 0.
- Arguments are ints. The module under test is importable as `impl`.
