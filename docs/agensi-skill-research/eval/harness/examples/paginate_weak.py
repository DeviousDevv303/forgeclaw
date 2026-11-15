from impl import paginate


def test_first_page():
    assert paginate(25, 1, 10) == (0, 10)
