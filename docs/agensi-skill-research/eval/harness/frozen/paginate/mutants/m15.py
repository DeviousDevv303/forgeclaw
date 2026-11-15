def paginate(total_items, page, per_page):
    if total_items < 1:
        raise ValueError('total_items must be >= 0')
    if page < 1:
        raise ValueError('page must be >= 1')
    if per_page < 1:
        raise ValueError('per_page must be >= 1')
    start = (page - 1) * per_page
    if start > total_items:
        start = total_items
    end = start + per_page
    if end > total_items:
        end = total_items
    return (start, end)
