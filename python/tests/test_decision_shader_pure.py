import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).resolve().parents[2] / 'scripts' / 'decision-shader-compiler.py'
spec = importlib.util.spec_from_file_location('decision_shader_compiler', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class DecisionShaderCompilerTests(unittest.TestCase):
    def test_shader_bytes_are_preserved_exactly(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)/'test.comp.cpp'
            source.write_text('#include "ggml-vulkan-shaders.hpp"\n'
                              'const uint64_t sample_len = 4;\n'
                              'const unsigned char sample_data[4] = {\n0x03,0x2,0x23,0xff,\n};\n')
            result = m.convert(source)
            self.assertEqual((source.with_name(source.name+'.blobs')/'sample.spv').read_bytes(), b'\x03\x02\x23\xff')
            out = result.read_text()
            self.assertIn('const uint64_t sample_len = 4;', out)
            self.assertIn('.globl sample_data', out)
            self.assertIn('.incbin', out)
            manifest = json.loads(result.with_suffix('.json').read_text())
            self.assertEqual(manifest['blobs'][0]['bytes'], 4)

    def test_geometry_disagreement_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'bad.comp.cpp'
            source.write_text('const uint64_t x_len = 2;\nconst unsigned char x_data[3] = {\n0x0,0x1,0x2,\n};\n')
            with self.assertRaises(ValueError):
                m.convert(source)

    def test_incomplete_shader_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'bad.comp.cpp'
            source.write_text('const uint64_t x_len = 2;\nconst unsigned char x_data[2] = {\n0x0,\n};\n')
            with self.assertRaises(ValueError):
                m.convert(source)

    def test_nonliteral_initializer_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'bad.comp.cpp'
            source.write_text('const uint64_t x_len = 1;\nconst unsigned char x_data[1] = {\nother(),\n};\n')
            with self.assertRaises(ValueError):
                m.convert(source)


if __name__ == '__main__':
    unittest.main()
