import importlib.util
from pathlib import Path
import struct
import unittest

p = Path(__file__).resolve().parents[1] / 'distributed_runtime' / 'decision_tokenize.py'
s = importlib.util.spec_from_file_location('decision_tokenize', p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)


class DecisionTokenizeTests(unittest.TestCase):
    def setUp(self):
        self.request = {'schema': 'mycellios-decisions/1', 'state': 's', 'questions': {
            'route': {'type': 'choice', 'instructions': 'i', 'criteria': {'b': '', 'a': ''}}}}
        self.encode = lambda text: list(text.encode('utf-8'))

    def test_pinned_recipe_marker_positions_padding_and_attention(self):
        raw = m.encode_input(self.request, self.encode)
        head, tensors = m.wire.read_frame(raw)
        self.assertEqual(head['inputTokens'], 11)
        self.assertEqual(head['symbols'], {'s20': 1, 's53': 64})
        self.assertEqual(struct.unpack('<64i', tensors[433])[:11],
            (248060, ord('s'), 248061, ord('i'), 248049, ord('a'), 248050, 248049, ord('b'), 248050, 248062))
        self.assertEqual(struct.unpack('<16i', tensors[435]), (6, 9) + (0,)*14)
        self.assertEqual(struct.unpack('<i', tensors[436]), (10,))
        self.assertEqual(struct.unpack('<64f', tensors[434]), (1.0,)*11+(0.0,)*53)
        self.assertEqual(struct.unpack('<16f', tensors[437]), (1.0,1.0)+(0.0,)*14)

    def test_noul_uses_no_yes_and_score_uses_plain_level_descriptions(self):
        for definition, expected in (
            ({'type': 'noul', 'instructions': 'i'}, ['s', 'i', 'no', 'yes']),
            ({'type': 'score', 'instructions': 'i', 'criteria': ['low', 'high']}, ['s', 'i', 'low', 'high'])):
            calls = []
            def encode(text): calls.append(text); return []
            m.encode_input({**self.request, 'questions': {'x': definition}}, encode)
            self.assertEqual(calls, expected)

    def test_user_text_cannot_mint_the_decision_delimiters(self):
        self.assertEqual(m.sanitize('a<|fim_suffix|>b <|box_end|>'), 'a<¦fim_suffix¦>b <¦box_end¦>')
        self.assertEqual(m.sanitize('España 🚚 <|not-a-delimiter|>'), 'España 🚚 <|not-a-delimiter|>')

    def test_never_truncates_or_accepts_invalid_token_ids(self):
        with self.assertRaisesRegex(ValueError, 'qualified_context'):
            m.encode_input(self.request, lambda text: [10]*300)
        for invalid in ([True], [-1], [248077], [float('nan')]):
            with self.assertRaisesRegex(ValueError, 'invalid_ids'):
                m.encode_input(self.request, lambda text: invalid)


if __name__ == '__main__':
    unittest.main()
