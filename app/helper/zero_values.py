"""Subdue zero amounts without changing cashflow values or base cell styles."""
from lxml import etree as E

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
GREY = 'FF999999'
RANGES = (('D8:V18', 'D8'), ('D21:V42', 'D21'))


def tag(name):
    return '{' + NS + '}' + name


def insert_before(parent, child, following):
    for i, existing in enumerate(parent):
        if existing.tag in {tag(name) for name in following}:
            parent.insert(i, child)
            return
    parent.append(child)


def apply_zero_format(sheet, styles):
    """Add native Excel conditional formatting, once, to monetary ranges only.

    ISNUMBER excludes blanks, text and dates outside the monetary areas. Only
    font colour is overridden, preserving number formats, bold totals and fills.
    """
    dxfs = styles.find(tag('dxfs'))
    if dxfs is None:
        dxfs = E.Element(tag('dxfs'), count='0')
        insert_before(styles, dxfs, ('tableStyles', 'colors', 'extLst'))
    desired = E.Element(tag('dxf'))
    E.SubElement(E.SubElement(desired, tag('font')), tag('color'), rgb=GREY)
    # Compare structure, not namespace-prefix serialization.
    dxf_id = next((i for i, d in enumerate(dxfs)
                   if len(d) == 1 and d[0].tag == tag('font') and len(d[0]) == 1
                   and d[0][0].tag == tag('color')
                   and dict(d[0][0].attrib) == {'rgb': GREY}), None)
    if dxf_id is None:
        dxf_id = len(dxfs)
        dxfs.append(desired)
    dxfs.set('count', str(len(dxfs)))
    missing = []
    for area, anchor in RANGES:
        formula = f'AND(ISNUMBER({anchor}),{anchor}=0)'
        exists = any(cf.get('sqref') == area and any(
            r.get('type') == 'expression' and r.get('dxfId') == str(dxf_id)
            and r.findtext(tag('formula')) == formula for r in cf)
            for cf in sheet.findall(tag('conditionalFormatting')))
        if not exists:
            missing.append((area, formula))
    if not missing:
        return
    # Keep existing rules and their relative order; the new rule changes only colour.
    for cf in sheet.findall(tag('conditionalFormatting')):
        for rule in cf:
            if rule.get('priority') is not None:
                rule.set('priority', str(int(rule.get('priority')) + len(missing)))
    following = ('dataValidations', 'hyperlinks', 'printOptions', 'pageMargins',
                 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
                 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags',
                 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture',
                 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst')
    for priority, (area, formula) in enumerate(missing, 1):
        cf = E.Element(tag('conditionalFormatting'), sqref=area)
        rule = E.SubElement(cf, tag('cfRule'), type='expression',
                            dxfId=str(dxf_id), priority=str(priority), stopIfTrue='0')
        E.SubElement(rule, tag('formula')).text = formula
        insert_before(sheet, cf, following)
