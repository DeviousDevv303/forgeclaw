from impl import paginate


def test_claims_zero_based_pages():
    assert paginate(25, 1, 10) == (10, 20)
