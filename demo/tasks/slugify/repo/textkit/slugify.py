def slugify(text: str) -> str:
    """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""
    return text.strip().lower().replace(" ", "-")
