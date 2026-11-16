"""Offline catalogue integrity: placeholders and runtime UI copy must survive builds."""
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]

class LocaleTests(unittest.TestCase):
    def test_complete_offline_catalogues(self):
        source=json.loads((ROOT/'web/locales/ru.json').read_text(encoding='utf8'))
        for code in ('en','es','it','fr'):
            data=json.loads((ROOT/f'web/locales/{code}.json').read_text(encoding='utf8'))
            self.assertFalse(set(source)-set(data),code)
            for key in source:
                value=data[key]
                self.assertIsInstance(value,str)
                self.assertTrue(value.strip(),(code,key))
                self.assertEqual(sorted(re.findall(r'\{\w+\}',key)),sorted(re.findall(r'\{\w+\}',value)),(code,key))
                self.assertNotRegex(value,r'QZP\d+ZQ|[А-Яа-яЁё]',(code,key))

    def test_editorial_review_survives_rebuild(self):
        reviewed=json.loads((ROOT/'tools/locale_overrides.json').read_text(encoding='utf8'))
        for code,entries in reviewed.items():
            data=json.loads((ROOT/f'web/locales/{code}.json').read_text(encoding='utf8'))
            for source,translation in entries.items():
                self.assertEqual(data[source],translation,(code,source))

if __name__=='__main__':unittest.main()
