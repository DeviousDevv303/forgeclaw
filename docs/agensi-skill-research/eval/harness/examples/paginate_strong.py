from impl import paginate


def raises(*args):
    try:
        paginate(*args)
    except ValueError:
        return True
    return False


def test_first_page_starts_at_zero():
    assert paginate(25, 1, 10) == (0, 10)


def test_middle_page():
    assert paginate(25, 2, 10) == (10, 20)


def test_last_partial_page_is_capped():
    assert paginate(25, 3, 10) == (20, 25)


def test_page_past_end_is_empty_at_total():
    assert paginate(25, 4, 10) == (25, 25)
    assert paginate(25, 9, 10) == (25, 25)


def test_exact_fit_last_page():
    assert paginate(20, 2, 10) == (10, 20)
    assert paginate(20, 3, 10) == (20, 20)


def test_empty_collection():
    assert paginate(0, 1, 10) == (0, 0)


def test_per_page_one():
    assert paginate(5, 5, 1) == (4, 5)
    assert paginate(1, 1, 1) == (0, 1)


def test_rejects_negative_total():
    assert raises(-1, 1, 10)
    assert not raises(0, 1, 10)


def test_rejects_page_below_one():
    assert raises(10, 0, 10)
    assert not raises(10, 1, 10)


def test_rejects_per_page_below_one():
    assert raises(10, 1, 0)
    assert not raises(10, 1, 1)
