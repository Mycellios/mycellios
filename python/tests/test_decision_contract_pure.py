import copy
import importlib.util
import json
from pathlib import Path
import unittest

p = Path(__file__).resolve().parents[1] / 'distributed_runtime' / 'decision_contract.py'
s = importlib.util.spec_from_file_location('decision_contract', p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)


class DecisionContractTests(unittest.TestCase):
    def setUp(self):
        self.request = {'schema': 'mycellios-decisions/1', 'state': 'A shipment is late. España 🚚',
            'questions': {'route': {'type': 'choice', 'instructions': 'Choose a team.',
                                    'criteria': {'z': 'sales', 'a': 'delivery'}}}}

    def test_choice_order_is_canonical_before_native_encoding(self):
        ordered = m.parse_input(self.request)
        self.assertEqual(list(ordered['questions']['route']['criteria']), ['a', 'z'])
        self.assertEqual(m.options(ordered), ['a', 'z'])
        changed = copy.deepcopy(self.request)
        changed['questions']['route']['criteria'] = {'a': 'delivery', 'z': 'sales'}
        self.assertEqual(m.request_digest(self.request), m.request_digest(changed))
        # Numeric-looking labels must not inherit JavaScript's integer-key order.
        changed['questions']['route']['criteria'] = {'2': 'two', '10': 'ten', '0': 'zero'}
        self.assertEqual(m.options(m.parse_input(changed)), ['0', '10', '2'])

    def test_choice_reports_winner_and_never_generated_tokens(self):
        result = m.decode(self.request, [2.0, 0.0] + [-9999.0]*14, 120)
        self.assertEqual(result['result']['value'], 'a')
        self.assertAlmostEqual(result['result']['probabilities'][0]['probability'], 0.8807970779778823)
        self.assertEqual(result['usage'], {'prompt_tokens': 120, 'completion_tokens': 0, 'total_tokens': 120})

    def test_noul_returns_probability_not_boolean_or_argmax(self):
        self.request['questions'] = {'fact': {'type': 'noul', 'instructions': 'It shipped.'}}
        result = m.decode(self.request, [0.0, 1.0] + [-9999.0]*14, 90)
        self.assertAlmostEqual(result['result']['value'], 0.7310585786300049)

    def test_score_returns_expectation_not_winning_index(self):
        self.request['questions'] = {'impact': {'type': 'score', 'instructions': 'Impact?',
            'criteria': ['none', 'partial', 'complete']}}
        result = m.decode(self.request, [0.0, 1.0, 2.0] + [-9999.0]*13, 90)
        self.assertAlmostEqual(result['result']['value'], 1.5752103826044412)

    def test_rejects_nonfinite_logits_and_unqualified_context(self):
        for logits, tokens in (([float('nan')]*16, 128), ([0.0]*16, 257), ([0.0]*15, 128), ([True]*16, 128)):
            with self.assertRaises(ValueError):
                m.decode(self.request, logits, tokens)

    def test_rejects_additional_questions_empty_criteria_and_nontext_state(self):
        for update in ({'state': {}}, {'questions': {}}, {'questions': {'a': {'type': 'score', 'instructions': '', 'criteria': []}}},
                       {'questions': {'a': {'type': 'noul', 'instructions': '', 'criteria': {'false': 'no'}}}}):
            with self.assertRaises(ValueError):
                m.parse_input({**self.request, **update})
        with self.assertRaises((ValueError, UnicodeError)):
            m.parse_input({**self.request, 'state': '\ud800'})


if __name__ == '__main__':
    unittest.main()
