"""The sanitizer for untrusted text: file contents and file names that reach the terminal.

Rule under test: every character outside printable ASCII (space to tilde) becomes a backslash
escape, so no control sequence or non-ASCII character can reach a terminal or break a stream
that cannot encode it. Normal ASCII text, backslashes included, is left alone.
"""

import unittest

from aicost.core.text import safe_text


def is_plain(text):
    return all(" " <= char <= "~" for char in text)


class Unchanged(unittest.TestCase):
    def test_normal_names_and_paths_are_not_touched(self):
        for text in (
            "claude-opus-5-5",
            "gpt-5.6-sol",
            "example-provider / model-a",
            "D:\\data\\usage 1.csv",
            "/srv/data/usage.jsonl",
            "https://example.com/pricing?a=1&b=2#top",
            "",
            " ",
        ):
            with self.subTest(text=text):
                self.assertEqual(safe_text(text), text)


class Escapes(unittest.TestCase):
    def test_control_characters(self):
        self.assertEqual(safe_text("a\x1b[31mred\x1b[0m"), "a\\x1b[31mred\\x1b[0m")
        self.assertEqual(safe_text("\x1b]0;title\x07"), "\\x1b]0;title\\x07")
        self.assertEqual(safe_text("a\nb\rc\td"), "a\\x0ab\\x0dc\\x09d")
        self.assertEqual(safe_text("nul\x00 del\x7f"), "nul\\x00 del\\x7f")

    def test_non_ascii_characters(self):
        self.assertEqual(safe_text("caf\u00e9"), "caf\\xe9")
        self.assertEqual(safe_text("\u8a9e"), "\\u8a9e")
        self.assertEqual(safe_text("\U0001f600"), "\\U0001f600")

    def test_unicode_line_separators_and_direction_controls(self):
        for char, expected in (
            ("\u2028", "\\u2028"),
            ("\u0085", "\\x85"),
            ("\u202e", "\\u202e"),  # right-to-left override
            ("\u200b", "\\u200b"),  # zero-width space
            ("\ufeff", "\\ufeff"),  # byte order mark
        ):
            with self.subTest(char=expected):
                self.assertEqual(safe_text("a" + char + "b"), "a" + expected + "b")

    def test_result_is_always_printable_ascii(self):
        everything = "".join(chr(code) for code in list(range(0x300)) + [0x2028, 0x202E, 0x1F600, 0x10FFFF])
        self.assertTrue(is_plain(safe_text(everything)))

    def test_escaping_twice_changes_nothing(self):
        once = safe_text("x\x1b[1m\u00e9\u8a9e")
        self.assertEqual(safe_text(once), once)

    def test_a_lone_surrogate_does_not_raise(self):
        self.assertEqual(safe_text("a\ud800b"), "a\\ud800b")


class Limit(unittest.TestCase):
    def test_long_text_is_cut_and_marked(self):
        text = safe_text("x" * 500, limit=80)
        self.assertEqual(text, "x" * 80 + "...")

    def test_text_at_the_limit_is_kept_whole(self):
        self.assertEqual(safe_text("x" * 80, limit=80), "x" * 80)

    def test_no_limit_by_default(self):
        self.assertEqual(len(safe_text("x" * 500)), 500)

    def test_the_cut_text_is_still_escaped(self):
        text = safe_text("\x1b" * 500, limit=80)
        self.assertTrue(is_plain(text))
        self.assertTrue(text.endswith("..."))


if __name__ == "__main__":
    unittest.main()
