"""Make untrusted text safe to print.

Names, file paths, and values in a usage export or a price table come from files that may
not be the user's own. Printed as they are, an escape sequence in them can move the cursor,
clear the screen, or set the window title, and a character the output stream cannot encode
(for example any non-ASCII character on a Windows console redirected to a file) raises an
error. `safe_text` turns every character outside printable ASCII into a backslash escape.
"""

from __future__ import annotations

import re

_UNSAFE = re.compile(r"[^\x20-\x7e]")


# How many characters of a file-supplied value an error message shows before cutting it.
ECHO_LIMIT = 80


def _escape(match: re.Match[str]) -> str:
    code = ord(match.group())
    if code < 0x100:
        return f"\\x{code:02x}"
    if code < 0x10000:
        return f"\\u{code:04x}"
    return f"\\U{code:08x}"


def safe_text(text: object, limit: int | None = None) -> str:
    """Return `text` with every character outside printable ASCII (space to tilde) escaped.

    Printable ASCII, backslash included, is left alone, so a normal name or path is returned
    unchanged and escaping twice changes nothing. With `limit`, text longer than that many
    characters is cut there and "..." is added; the cut is made before escaping.
    """
    value = str(text)
    if limit is not None and len(value) > limit:
        value = value[:limit] + "..."
    return _UNSAFE.sub(_escape, value)
