import pytest
from textkit.slugify import slugify


@pytest.mark.parametrize("text,expected", [
    ("Hello, World!", "hello-world"),
    ("  many   spaces  ", "many-spaces"),
    ("Crème Brûlée", "creme-brulee"),
    ("a--b__c", "a-b-c"),
    ("ETHGlobal Mumbai 2026", "ethglobal-mumbai-2026"),
    ("!!!", ""),
    ("", ""),
])
def test_hidden(text, expected):
    assert slugify(text) == expected
