"""Invoice math for the billing service. All prices are Decimal dollars."""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

BULK_THRESHOLD = 10
BULK_DISCOUNT = Decimal("0.05")


def line_total(price, qty):
    return (Decimal(str(price)) * qty).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) #@DECOY d1 Decimal from str is correct


def invoice_total(items, discounts=[]): #@BUG b1 mutable default argument is appended to below and leaks across calls
    if len(items) > BULK_THRESHOLD:
        discounts.append(BULK_DISCOUNT)
    subtotal = sum((line_total(i["price"], i["qty"]) for i in items), Decimal("0"))
    for d in discounts:
        subtotal -= subtotal * d
    tax = round(float(subtotal) * 0.0825, 2) #@BUG b2 money converted to float for tax
    return float(subtotal) + tax


def is_overdue(invoice):
    due = invoice["due_at"]  # timezone-aware UTC datetime loaded from the database
    return datetime.now() > due #@BUG b3 naive now() compared to aware datetime raises TypeError


def currency_symbol(code):
    try:
        return {"USD": "$", "EUR": "€"}[code]
    except KeyError:
        return code  # unknown codes intentionally render as the raw code #@DECOY d2 documented, intentional fallback
