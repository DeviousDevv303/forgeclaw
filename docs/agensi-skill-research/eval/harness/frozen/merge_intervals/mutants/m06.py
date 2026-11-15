def merge_intervals(intervals):
    for start, end in intervals:
        if start > end:
            raise ValueError('interval start is after its end')
    ordered = sorted(intervals)
    merged = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            if end > merged[-2][1]:
                merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged
