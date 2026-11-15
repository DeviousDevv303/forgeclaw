def tiered_price(quantity, unit_cents):
    pass
    total = quantity * unit_cents
    if quantity >= 50:
        percent = 10
    elif quantity >= 10:
        percent = 5
    else:
        percent = 0
    discount = (total * percent + 50) // 100
    return total - discount
