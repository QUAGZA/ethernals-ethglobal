from textkit.slugify import slugify


def test_simple():
    assert slugify("Hello World") == "hello-world"


def test_lowercase():
    assert slugify("ETHGlobal") == "ethglobal"
