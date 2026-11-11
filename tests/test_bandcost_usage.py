import json
import tempfile
import unittest
from pathlib import Path

from aicost.bandcost import UsageError, load_usage, parse_usage_csv, parse_usage_jsonl

CSV = "model,input_tokens,output_tokens\nm1,1200,300\nm2,0,5\n"


class Csv(unittest.TestCase):
    def test_basic(self):
        records = parse_usage_csv(CSV)
        self.assertEqual([(r.model, r.input_tokens, r.output_tokens) for r in records],
                         [("m1", 1200, 300), ("m2", 0, 5)])
        self.assertEqual([r.line for r in records], [2, 3])
        self.assertIsNone(records[0].provider)

    def test_extra_columns_provider_and_crlf(self):
        text = ("id,provider,model,input_tokens,output_tokens,note\r\n"
                "7,p1,m1,10,20,hello\r\n"
                "8,,m2,30,40,\"a, quoted\"\r\n")
        a, b = parse_usage_csv(text)
        self.assertEqual((a.provider, a.model), ("p1", "m1"))
        self.assertIsNone(b.provider)
        self.assertEqual((b.input_tokens, b.output_tokens), (30, 40))

    def test_quoted_model_with_comma_and_blank_line(self):
        records = parse_usage_csv('model,input_tokens,output_tokens\n"m,1",1,2\n\n"m2",3,4\n')
        self.assertEqual([r.model for r in records], ["m,1", "m2"])

    def test_bad_counts_are_all_reported_with_line_numbers(self):
        text = ("model,input_tokens,output_tokens\n"
                "m,1.5,1\nm,-1,1\nm,1,\nm,1 200,1\nm,1,abc\nm,١,1\nm,1,1\n")
        with self.assertRaises(UsageError) as raised:
            parse_usage_csv(text)
        found = raised.exception.problems
        self.assertEqual(len(found), 6, found)
        for line in range(2, 8):
            self.assertTrue(any(p.startswith(f"line {line}:") for p in found), (line, found))

    def test_blank_model_and_wrong_field_count(self):
        text = "model,input_tokens,output_tokens\n ,1,1\nm,1\nm,1,1,9\n"
        with self.assertRaises(UsageError) as raised:
            parse_usage_csv(text)
        self.assertEqual(len(raised.exception.problems), 3)

    def test_header_problems(self):
        for text, fragment in (
            ("model,input_tokens\nm,1\n", "missing required column 'output_tokens'"),
            ("model,model,input_tokens,output_tokens\nm,m,1,1\n", "duplicate column 'model'"),
            ("", "empty"),
            ("model,input_tokens,output_tokens\n", "no usage records"),
        ):
            with self.subTest(fragment=fragment):
                with self.assertRaises(UsageError) as raised:
                    parse_usage_csv(text)
                self.assertTrue(any(fragment in p for p in raised.exception.problems))

    def test_surrounding_spaces_are_trimmed(self):
        (r,) = parse_usage_csv("model, input_tokens ,output_tokens\n m1 , 12 , 34 \n")
        self.assertEqual((r.model, r.input_tokens, r.output_tokens), ("m1", 12, 34))


class JsonLines(unittest.TestCase):
    def test_basic_blank_lines_and_extra_keys(self):
        text = ('{"model": "m1", "input_tokens": 5, "output_tokens": 6, "extra": [1]}\n\n'
                '{"provider": "p", "model": "m2", "input_tokens": 0, "output_tokens": 0}\r\n')
        a, b = parse_usage_jsonl(text)
        self.assertEqual((a.model, a.input_tokens, a.output_tokens, a.line), ("m1", 5, 6, 1))
        self.assertEqual((b.provider, b.line), ("p", 3))

    def test_rejections_are_all_reported(self):
        lines = [
            '{"model": "m", "input_tokens": 1.5, "output_tokens": 1}',
            '{"model": "m", "input_tokens": "12", "output_tokens": 1}',
            '{"model": "m", "input_tokens": true, "output_tokens": 1}',
            '{"model": "m", "input_tokens": -3, "output_tokens": 1}',
            '{"model": "m", "input_tokens": NaN, "output_tokens": 1}',
            '{"model": "m", "input_tokens": 1}',
            '{"input_tokens": 1, "output_tokens": 1}',
            '[1, 2]',
            '{not json',
        ]
        with self.assertRaises(UsageError) as raised:
            parse_usage_jsonl("\n".join(lines))
        found = raised.exception.problems
        self.assertEqual(len(found), len(lines), found)

    def test_no_records(self):
        with self.assertRaises(UsageError):
            parse_usage_jsonl("\n\n")


class LoadFromFile(unittest.TestCase):
    def write(self, name, data):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / name
        path.write_bytes(data)
        return path

    def test_csv_with_byte_order_mark(self):
        path = self.write("u.csv", b"\xef\xbb\xbf" + CSV.encode())
        self.assertEqual(len(load_usage(path)), 2)

    def test_jsonl_by_suffix_and_explicit_format(self):
        data = b'{"model": "m", "input_tokens": 1, "output_tokens": 2}\n'
        self.assertEqual(len(load_usage(self.write("u.jsonl", data))), 1)
        self.assertEqual(len(load_usage(self.write("u.txt", data), fmt="jsonl")), 1)

    def test_unknown_suffix_and_bad_encoding(self):
        with self.assertRaises(UsageError):
            load_usage(self.write("u.txt", CSV.encode()))
        with self.assertRaises(UsageError) as raised:
            load_usage(self.write("u.csv", b"model,input_tokens,output_tokens\n\xff,1,1\n"))
        self.assertIn("UTF-8", raised.exception.problems[0])


MAX_TOKENS = 10**15  # the most one count field may hold; see MAX_TOKENS in usage.py
HEADER = "model,input_tokens,output_tokens\n"


def problems_of(parse, text):
    try:
        parse(text)
    except UsageError as error:
        return error.problems
    raise AssertionError("expected a UsageError")


def jsonl_line(**fields):
    base = {"model": "m", "input_tokens": 1, "output_tokens": 1}
    base.update(fields)
    return json.dumps(base)


class WhitespaceOnlyLines(unittest.TestCase):
    def test_a_line_of_spaces_or_tabs_is_skipped_like_a_blank_line(self):
        text = HEADER + "m,1,1\n   \n\t\nm,2,2\n  \n"
        records = parse_usage_csv(text)
        self.assertEqual([(r.input_tokens, r.line) for r in records], [(1, 2), (2, 5)])

    def test_a_row_of_empty_fields_is_still_an_error(self):
        found = problems_of(parse_usage_csv, HEADER + "m,1,1\n,,\n")
        self.assertTrue(found and all(p.startswith("line 3:") for p in found), found)

    def test_a_line_with_text_in_one_field_is_still_a_wrong_field_count(self):
        found = problems_of(parse_usage_csv, HEADER + "  abc  \nm,1,1\n")
        self.assertEqual(found, ["line 2: expected 3 fields, found 1"])

    def test_a_one_column_file_is_rejected_by_the_header_check(self):
        found = problems_of(parse_usage_csv, "model\nm\n   \n")
        self.assertTrue(any("missing required column" in p for p in found), found)


class CountLimits(unittest.TestCase):
    """A count above MAX_TOKENS is a reported problem, never an exception, in both formats."""

    def test_csv_accepts_the_limit_and_rejects_one_more(self):
        (record,) = parse_usage_csv(HEADER + f"m,{MAX_TOKENS},{MAX_TOKENS}\n")
        self.assertEqual((record.input_tokens, record.output_tokens), (MAX_TOKENS, MAX_TOKENS))
        found = problems_of(parse_usage_csv, HEADER + f"m,{MAX_TOKENS + 1},1\nm,1,{MAX_TOKENS + 1}\n")
        self.assertEqual(len(found), 2, found)
        self.assertTrue(found[0].startswith("line 2: input_tokens is too large"), found)
        self.assertTrue(found[1].startswith("line 3: output_tokens is too large"), found)
        self.assertIn("1,000,000,000,000,000", found[0])

    def test_csv_integer_with_thousands_of_digits_is_a_problem_not_a_crash(self):
        found = problems_of(parse_usage_csv, HEADER + "m," + "9" * 5000 + ",1\nm,1,1\n")
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0].startswith("line 2: input_tokens is too large"), found)
        self.assertLess(len(found[0]), 200)  # the digits are not echoed

    def test_csv_leading_zeros_do_not_count_as_digits(self):
        (record,) = parse_usage_csv(HEADER + "m," + "0" * 5000 + "7,1\n")
        self.assertEqual(record.input_tokens, 7)

    def test_jsonl_accepts_the_limit_and_rejects_one_more(self):
        (record,) = parse_usage_jsonl(jsonl_line(input_tokens=MAX_TOKENS, output_tokens=MAX_TOKENS))
        self.assertEqual(record.input_tokens, MAX_TOKENS)
        text = "\n".join([jsonl_line(input_tokens=MAX_TOKENS + 1), jsonl_line(output_tokens=MAX_TOKENS + 1)])
        found = problems_of(parse_usage_jsonl, text)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(found[0].startswith("line 1: input_tokens is too large"), found)
        self.assertTrue(found[1].startswith("line 2: output_tokens is too large"), found)

    def test_jsonl_integer_with_thousands_of_digits_is_a_problem_not_a_crash(self):
        text = '{"model": "m", "input_tokens": ' + "9" * 5000 + ', "output_tokens": 1}\n' + jsonl_line()
        found = problems_of(parse_usage_jsonl, text)
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0].startswith("line 1: input_tokens is too large"), found)
        self.assertLess(len(found[0]), 200)

    def test_jsonl_huge_negative_integer_is_reported_as_negative(self):
        text = '{"model": "m", "input_tokens": -' + "9" * 5000 + ', "output_tokens": 1}'
        found = problems_of(parse_usage_jsonl, text)
        self.assertEqual(len(found), 1, found)
        self.assertIn("non-negative whole number", found[0])
        self.assertLess(len(found[0]), 200)

    def test_jsonl_huge_integer_in_an_ignored_key_is_harmless(self):
        text = '{"model": "m", "input_tokens": 3, "output_tokens": 4, "extra": ' + "9" * 5000 + "}"
        (record,) = parse_usage_jsonl(text)
        self.assertEqual((record.input_tokens, record.output_tokens), (3, 4))


class NestingLimits(unittest.TestCase):
    def test_deeply_nested_json_is_a_problem_not_a_crash(self):
        deep = "[" * 100_000
        text = "\n".join([jsonl_line(), deep, jsonl_line(input_tokens=-1), jsonl_line()])
        found = problems_of(parse_usage_jsonl, text)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(found[0].startswith("line 2:"), found)
        self.assertIn("nested too deeply", found[0])
        self.assertTrue(found[1].startswith("line 3:"), found)  # reading went on past line 2

    def test_deeply_nested_json_in_an_ignored_key_on_a_moderate_line(self):
        text = '{"model": "m", "input_tokens": 1, "output_tokens": 1, "extra": ' + "[" * 50 + "]" * 50 + "}"
        self.assertEqual(len(parse_usage_jsonl(text)), 1)


class EchoedValues(unittest.TestCase):
    def test_a_bad_count_is_echoed_escaped_and_cut(self):
        found = problems_of(parse_usage_csv, HEADER + "m,\x1b[2J" + "x" * 300 + ",1\n")
        self.assertEqual(len(found), 1, found)
        self.assertTrue(all(" " <= c <= "~" for c in found[0]), found[0])
        self.assertIn("\\x1b[2J", found[0])
        self.assertLess(len(found[0]), 250)

    def test_a_json_container_is_described_by_type_not_printed(self):
        text = "\n".join([
            '{"model": "m", "input_tokens": [1, 2], "output_tokens": 1}',
            '{"model": "m", "input_tokens": {"a": 1}, "output_tokens": 1}',
            '{"model": "m", "input_tokens": null, "output_tokens": 1}',
        ])
        found = problems_of(parse_usage_jsonl, text)
        self.assertEqual(len(found), 3, found)
        self.assertIn("got a list", found[0])
        self.assertIn("got an object", found[1])
        self.assertIn("got None", found[2])


class UncoveredPaths(unittest.TestCase):
    """Branches the earlier tests never ran."""

    def test_provider_must_be_a_non_empty_string_when_present(self):
        text = "\n".join([
            jsonl_line(provider=5),
            jsonl_line(provider="   "),
            jsonl_line(provider=""),  # an empty provider means "none given"
            jsonl_line(provider=None),
        ])
        found = problems_of(parse_usage_jsonl, text)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(all("provider, when present, must be a non-empty string" in p for p in found))
        self.assertTrue(found[0].startswith("line 1:") and found[1].startswith("line 2:"), found)

    def test_csv_header_that_is_not_valid_csv(self):
        found = problems_of(parse_usage_csv, "model,input_tokens,output_tokens," + "x" * 200_000 + "\nm,1,1\n")
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0].startswith("line 1: not valid CSV"), found)

    def test_csv_row_that_is_not_valid_csv_stops_reading_but_is_reported(self):
        text = HEADER + "m,1,1\n" + "m,1," + "x" * 200_000 + "\nm,2,2\n"
        found = problems_of(parse_usage_csv, text)
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0].startswith("line 3: not valid CSV"), found)


if __name__ == "__main__":
    unittest.main()
