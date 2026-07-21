"""Deployment configuration — mainly that CORS stays an allow-list."""

from __future__ import annotations

from app.config import Settings


def _settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_dev_origin_is_always_allowed():
    """`npm run dev` must work with no configuration at all."""
    assert _settings().allowed_origins == ["http://localhost:5173"]


def test_configured_origins_are_added():
    s = _settings(cors_origins="https://a.vercel.app,https://b.example.com")
    assert s.allowed_origins == [
        "http://localhost:5173",
        "https://a.vercel.app",
        "https://b.example.com",
    ]


def test_whitespace_and_trailing_slashes_are_tolerated():
    """A pasted URL usually arrives with a trailing slash; CORS matching is
    exact, so one would silently refuse the origin it was meant to allow."""
    s = _settings(cors_origins=" https://a.vercel.app/ , https://b.example.com ")
    assert s.allowed_origins[1:] == ["https://a.vercel.app", "https://b.example.com"]


def test_empty_entries_never_become_a_wildcard():
    """A stray comma must not widen access."""
    assert _settings(cors_origins=",, ,").allowed_origins == ["http://localhost:5173"]
