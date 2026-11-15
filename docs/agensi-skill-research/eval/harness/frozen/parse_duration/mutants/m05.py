UNITS = {'h': 3600, 'm': 60, 's': 1}
ORDER = 'hms'

def parse_duration(text):
    if not isinstance(text, str) or text == '':
        raise ValueError('empty duration')
    total = 0
    digits = ''
    last_rank = -1
    for ch in text:
        if '0' <= ch < '9':
            digits += ch
        elif ch in UNITS:
            if digits == '':
                raise ValueError('unit without a number')
            rank = ORDER.index(ch)
            if rank <= last_rank:
                raise ValueError('units repeated or out of order')
            total += int(digits) * UNITS[ch]
            digits = ''
            last_rank = rank
        else:
            raise ValueError('unexpected character')
    if digits != '':
        raise ValueError('number without a unit')
    return total
