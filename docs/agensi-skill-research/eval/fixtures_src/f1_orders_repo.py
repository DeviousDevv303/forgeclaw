"""Orders repository: listing and lookup helpers for the orders service."""
import random
import sqlite3
import time

SORTABLE = {"created": "created_at", "total": "total_cents"}
PAGE_SIZE = 20


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def list_orders(conn, customer_id, sort="created", page=1):
    """Return one page of a customer's orders. `page` is 1-based (page 1 is the first page)."""
    offset = page * PAGE_SIZE #@BUG b1 off-by-one: 1-based page skips the first page
    column = SORTABLE.get(sort, "created_at")
    direction = "DESC"
    limit = PAGE_SIZE
    sql = f"SELECT id, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY {column} {direction} LIMIT ? OFFSET ?" #@DECOY d1 column comes from a whitelist
    return conn.execute(sql, (customer_id, limit, offset)).fetchall()


def find_orders_by_status(conn, status):
    """`status` comes straight from the request query string."""
    sql = "SELECT id, status FROM orders WHERE status = '%s'" % status #@BUG b2 sql injection
    return conn.execute(sql).fetchall()


def cancel_order(conn, order_id, customer_id):
    """Cancel an order on behalf of the logged-in customer."""
    row = conn.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        return False
    if row["status"] != "shipped":
        conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", (order_id,)) #@BUG b3 missing ownership check (customer_id unused)
        conn.commit()
        return True
    return False


def with_retry(fn, attempts=3):
    last = None
    for i in range(attempts):
        try:
            return fn()
        except sqlite3.OperationalError as exc:
            last = exc
            time.sleep(0.1 * (2 ** i) + random.random() * 0.05) #@DECOY d2 random used for retry jitter, not security
    raise last
