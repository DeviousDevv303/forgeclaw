def tiered_price(quantity, unit_cents):
    if quantity < 0 or unit_cents < 0:
        raise ValueError('quantity and unit_cents must be >= 0')
    total = quantity * unit_cents
    if quantity >= 51:
        percent = 10
    elif quantity >= 10:
        percent = 5
    else:
        percent = 0
    discount = (total * percent + 50) // 100
    return total - discount
