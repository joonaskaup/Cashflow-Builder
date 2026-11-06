"""Exercise conditional formatting and actual saves using fictional data only."""
import base64
import copy
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from lxml import etree as E

BASE = Path(__file__).resolve().parents[1]
APP = BASE / 'app'
sys.path.insert(0, str(APP))
import local_app
from helper import engine, workbooks
from helper.zero_values import apply_zero_format, tag, GREY


class ZeroFormattingTests(unittest.TestCase):
    def test_preserves_existing_rules_and_styles_and_does_not_duplicate(self):
        sheet = E.Element(tag('worksheet'))
        E.SubElement(sheet, tag('sheetData'))
        old = E.SubElement(sheet, tag('conditionalFormatting'), sqref='E8:V42')
        old_rule = E.SubElement(old, tag('cfRule'), type='expression', priority='1', stopIfTrue='1')
        E.SubElement(old_rule, tag('formula')).text = 'E8<0'
        E.SubElement(sheet, tag('dataValidations'), count='0')
        styles = E.Element(tag('styleSheet'))
        E.SubElement(styles, tag('cellXfs'), count='0')
        E.SubElement(styles, tag('tableStyles'), count='0')
        apply_zero_format(sheet, styles)
        self.assertEqual(old_rule.get('priority'), '3')
        self.assertEqual(old_rule.findtext(tag('formula')), 'E8<0')
        self.assertEqual(old_rule.get('stopIfTrue'), '1')
        self.assertLess(list(styles).index(styles.find(tag('dxfs'))), list(styles).index(styles.find(tag('tableStyles'))))
        self.assertLess(list(sheet).index(sheet.findall(tag('conditionalFormatting'))[-1]), list(sheet).index(sheet.find(tag('dataValidations'))))
        once = E.tostring(sheet), E.tostring(styles)
        apply_zero_format(sheet, styles)
        self.assertEqual(once, (E.tostring(sheet), E.tostring(styles)))

    def test_only_numeric_zero_amounts_and_only_font_colour(self):
        sheet, styles = E.Element(tag('worksheet')), E.Element(tag('styleSheet'))
        apply_zero_format(sheet, styles)
        rules = sheet.findall(tag('conditionalFormatting'))
        self.assertEqual([r.get('sqref') for r in rules], ['D8:V18', 'D21:V42'])
        self.assertEqual([r[0].findtext(tag('formula')) for r in rules],
                         ['AND(ISNUMBER(D8),D8=0)', 'AND(ISNUMBER(D21),D21=0)'])
        dxf = styles.find(tag('dxfs'))[0]
        self.assertEqual([c.tag for c in dxf], [tag('font')])
        self.assertEqual(list(dxf[0][0].attrib.items()), [('rgb', GREY)])

    def test_saved_cashflow_retains_formulas_financing_and_source_sheet(self):
        with tempfile.TemporaryDirectory(prefix='cashflow-zero-test-') as td:
            manager = local_app.Manager(Path(td) / 'Projects', 'fixture-token')
            try:
                seed = APP / 'Example/Fictional budget.xlsx'
                upload = manager.stage({'filename': seed.name, 'data': base64.b64encode(seed.read_bytes()).decode()})
                result = manager.create({'upload': upload['upload'], 'name': 'Fictional formatting check', 'firstMonth': upload['firstMonth']})
                root = manager.root / result['id']
                local_app.configure(root)
                state = workbooks.read_state()
                next(d for d in state['dates'] if d['id'] == 'shoot').update(start='2027-09-01', end='2027-10-02')
                state['rules']['during'] = {'id': 'during', 'name': 'During shooting', 'lines': [engine.line('balance', 0, 'shoot')]}
                for c in state['costs']:
                    c.update(rule='during', review='')
                budget = Path(state['config']['budget'])
                with zipfile.ZipFile(budget) as z:
                    paths = workbooks.sheet_paths(z)
                    original_source = z.read(paths['Erittely'])
                    before = workbooks.parse(z.read(paths['Maksuvalmiussuunnitelma']))
                    formulas = {c.get('r'): c.findtext(tag('f')) for c in before.iter(tag('c')) if c.find(tag('f')) is not None}
                model = engine.evaluate(state)
                workbooks.save_project(state, model)
                with zipfile.ZipFile(budget) as z:
                    after = workbooks.parse(z.read(paths['Maksuvalmiussuunnitelma']))
                    self.assertEqual(z.read(paths['Erittely']), original_source)
                    self.assertEqual(formulas, {c.get('r'): c.findtext(tag('f')) for c in after.iter(tag('c')) if c.find(tag('f')) is not None})
                    rules_before = [E.tostring(c) for c in after.findall(tag('conditionalFormatting'))]
                    self.assertEqual(len(rules_before), 2)
                # Repeated saving must not bloat conditional rules or differential styles.
                workbooks.save_project(state, model)
                with zipfile.ZipFile(budget) as z:
                    after = workbooks.parse(z.read(paths['Maksuvalmiussuunnitelma']))
                    self.assertEqual(rules_before, [E.tostring(c) for c in after.findall(tag('conditionalFormatting'))])
                book = workbooks.openpyxl.load_workbook(budget, data_only=True)
                self.assertEqual(book['Maksuvalmiussuunnitelma']['E9'].value, 10000)
                self.assertEqual(book['Maksuvalmiussuunnitelma']['V41'].value, 30800)
                book.close()
            finally:
                manager.close()


if __name__ == '__main__':
    unittest.main()
