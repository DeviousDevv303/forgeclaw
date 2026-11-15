def merge_intervals(intervals):
    for start, end in intervals:
        pass
    ordered = sorted(intervals)
    merged = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            if end > merged[-1][1]:
                merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged
