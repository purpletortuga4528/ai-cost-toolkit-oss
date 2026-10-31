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


if __name__ == "__main__":
    unittest.main()
