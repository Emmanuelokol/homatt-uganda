#!/usr/bin/env python3
"""
Build emhslu_2023.db — the Essential Medicines and Health Supplies List for
Uganda (EMHSLU) 2023, Ministry of Health — from the published markdown.

What the clinic uses it for:
  • the national formulary behind drug search (official name / form / strength)
  • what a facility of a given LEVEL may stock and prescribe (HC2 … NR)
  • VEN classification (V=vital, E=essential, N=necessary) for stock priority
  • health supplies and laboratory supplies lists for stock/ordering

Schema
  emhslu_sections(code, title)
  emhslu_categories(id, section, number, title)
  emhslu_items(id, section, category_id, category_number, category_title,
               item_type, name, dosage_form, strength, specification,
               level_of_care, ven_class, specialist, source_line)
  emhslu_fts            -- FTS5 over name/form/strength/specification/category
  v_emhslu_by_level     -- one row per item per level it is allowed at
  v_emhslu_medicines    -- medicines only, tidy columns

Usage: python3 build_emhslu_db.py <input.md> <output.db>
"""
import os
import re
import sqlite3
import sys

LEVELS = ['HC2', 'HC3', 'HC4', 'H', 'RR', 'NR', 'HC1']
LEVEL_ORDER = ['HC1', 'HC2', 'HC3', 'HC4', 'H', 'RR', 'NR']
VEN = ['V', 'E', 'N']

SECTION_RE = re.compile(r'^SECTION\s+([A-D]):\s*(.+?)\s*$')
CATEGORY_RE = re.compile(r'^(\d+(?:\.\d+)*)\.?\s+([A-Za-z][^|]{2,80})$')
# trailing "HC4 V" / "H V" / "RR E" — the level + VEN pair every item carries
LC_RE = re.compile(r'\b(HC[1-4]|RR|NR|H)\s*[/ ]?\s*([VEN])\s*$')
SPECIALIST_RE = re.compile(r'^\s*specialist\s+medicines?\s*$', re.I)
NOISE_RE = re.compile(r'^\s*(EMHSLU|Page\s*\d+|\d+\s+EMHSLU|EMHSLU:.*)\s*$', re.I)

SCHEMA = """
CREATE TABLE emhslu_sections (code TEXT PRIMARY KEY, title TEXT);
CREATE TABLE emhslu_categories (
  id INTEGER PRIMARY KEY, section TEXT, number TEXT, title TEXT);
CREATE TABLE emhslu_items (
  id INTEGER PRIMARY KEY,
  section TEXT, category_id INTEGER, category_number TEXT, category_title TEXT,
  item_type TEXT,                    -- medicine | health_supply | lab_supply
  name TEXT, dosage_form TEXT, strength TEXT, specification TEXT,
  level_of_care TEXT, ven_class TEXT, specialist INTEGER, source_line TEXT);
CREATE INDEX idx_em_name  ON emhslu_items(name);
CREATE INDEX idx_em_level ON emhslu_items(level_of_care);
CREATE INDEX idx_em_ven   ON emhslu_items(ven_class);
CREATE INDEX idx_em_type  ON emhslu_items(item_type);
CREATE VIRTUAL TABLE emhslu_fts USING fts5(
  name, dosage_form, strength, specification, category_title,
  content='emhslu_items', content_rowid='id', tokenize="unicode61");
CREATE VIEW v_emhslu_medicines AS
  SELECT id, name, dosage_form, strength, level_of_care, ven_class,
         category_number, category_title, specialist
    FROM emhslu_items WHERE item_type='medicine';
"""


def norm(s):
    s = re.sub(r'\s+', ' ', (s or '')).strip()
    return s.strip(' .;:-')


def split_lc(tok):
    """'HC4 V' → ('HC4','V')."""
    m = LC_RE.search((tok or '').strip())
    if not m:
        return None, None
    return m.group(1).upper(), m.group(2).upper()


def levels_from(level):
    """A level entry means: allowed at that level AND every higher one."""
    if not level or level not in LEVEL_ORDER:
        return []
    return LEVEL_ORDER[LEVEL_ORDER.index(level):]


def split_table_row(line):
    cells = [c.strip() for c in line.strip().strip('|').split('|')]
    return cells


def is_separator(cells):
    return all(re.fullmatch(r'-{2,}|:?-{2,}:?|', c) for c in cells)


def main(src, dst):
    lines = open(src, encoding='utf-8', errors='replace').read().split('\n')

    if os.path.exists(dst):
        os.remove(dst)
    db = sqlite3.connect(dst)
    db.executescript(SCHEMA)

    section = None
    section_titles = {}
    cat_number = cat_title = None
    cat_id = None
    specialist = 0
    cats = {}
    n_items = 0
    body_started = False

    def ensure_cat():
        nonlocal cat_id
        if not cat_number:
            cat_id = None
            return
        key = (section, cat_number)
        if key not in cats:
            cur = db.execute(
                'INSERT INTO emhslu_categories(section,number,title) VALUES (?,?,?)',
                (section, cat_number, cat_title))
            cats[key] = cur.lastrowid
        cat_id = cats[key]

    def item_type_for(sec):
        return {'A': 'medicine', 'B': 'health_supply',
                'C': 'health_supply', 'D': 'lab_supply'}.get(sec, 'health_supply')

    def add_item(name, form, strength, spec, level, ven, raw):
        nonlocal n_items
        name = norm(name)
        if not name or len(name) < 2:
            return
        if NOISE_RE.match(name):
            return
        db.execute(
            'INSERT INTO emhslu_items(section,category_id,category_number,category_title,'
            'item_type,name,dosage_form,strength,specification,level_of_care,ven_class,'
            'specialist,source_line) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (section, cat_id, cat_number, cat_title, item_type_for(section),
             name, norm(form) or None, norm(strength) or None, norm(spec) or None,
             level, ven, specialist, raw[:400]))
        n_items += 1

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue

        m = SECTION_RE.match(stripped)
        if m:
            # The contents page lists the same headings; the BODY occurrence is
            # the one that starts real content (no dotted leader).
            if '....' in stripped:
                continue
            section = m.group(1)
            section_titles[section] = norm(m.group(2))
            cat_number = cat_title = None
            cat_id = None
            specialist = 0
            body_started = True
            continue
        if not body_started:
            continue

        if SPECIALIST_RE.match(stripped):
            specialist = 1
            continue

        # Table rows
        if stripped.startswith('|'):
            cells = split_table_row(stripped)
            if is_separator(cells):
                continue
            head = ' '.join(cells).upper()
            if 'MEDICINE' in head and ('STR' in head or 'DS' in head):
                continue                        # header row
            if 'ITEM DESCRIPTION' in head or 'SPECIFICATION' in head.split('|')[0]:
                continue
            if len(cells) >= 4:
                level, ven = split_lc(cells[-1])
                if level:
                    add_item(cells[0], cells[1], cells[2], None, level, ven, stripped)
                    continue
            if len(cells) == 3:
                level, ven = split_lc(cells[-1])
                if level:
                    add_item(cells[0], None, None, cells[1], level, ven, stripped)
                    continue
            continue

        # Category heading (e.g. "1.1 General anaesthetics and oxygen")
        cm = CATEGORY_RE.match(stripped)
        if cm and not LC_RE.search(stripped):
            cat_number = cm.group(1)
            cat_title = norm(cm.group(2))
            specialist = 0
            ensure_cat()
            continue

        # Plain-text item line: "<name> <form> <strength> HC4 V"
        level, ven = split_lc(stripped)
        if level:
            body = LC_RE.sub('', stripped).strip()
            if section == 'A':
                # split "Name  Form  Strength" — the form usually starts with a
                # known dosage word, everything before it is the name.
                fm = re.search(
                    r'\b(Injection|Tablet|Tablets|Capsule|Capsules|Oral liquid|Syrup|Suspension|'
                    r'Solution|Cream|Ointment|Gel|Drops|Eye drops|Ear drops|Inhalation|'
                    r'Liquid for inhalation|Medical gas|Powder|Suppository|Pessary|Patch|'
                    r'Granules|Emulsion|Infusion|Spray|Lotion|Paste|Implant|Sachet)\b', body, re.I)
                if fm:
                    name = body[:fm.start()]
                    rest = body[fm.start():]
                    sm = re.search(r'\s(\d[\d.,%/\s]*\S*.*)$', rest)
                    if sm:
                        add_item(name, rest[:sm.start()], sm.group(1), None, level, ven, stripped)
                    else:
                        add_item(name, rest, None, None, level, ven, stripped)
                else:
                    add_item(body, None, None, None, level, ven, stripped)
            else:
                add_item(body, None, None, None, level, ven, stripped)

    for code, title in sorted(section_titles.items()):
        db.execute('INSERT OR REPLACE INTO emhslu_sections(code,title) VALUES (?,?)',
                   (code, title))

    # level expansion view (an item at HC2 is also available at HC3, HC4 …)
    db.execute('CREATE TABLE emhslu_item_levels (item_id INTEGER, level TEXT)')
    for iid, lvl in db.execute('SELECT id, level_of_care FROM emhslu_items').fetchall():
        for l in levels_from(lvl):
            db.execute('INSERT INTO emhslu_item_levels(item_id,level) VALUES (?,?)', (iid, l))
    db.execute('CREATE INDEX idx_em_lvl2 ON emhslu_item_levels(level)')
    db.execute("""CREATE VIEW v_emhslu_by_level AS
        SELECT l.level, i.* FROM emhslu_item_levels l JOIN emhslu_items i ON i.id = l.item_id""")

    db.execute("INSERT INTO emhslu_fts(rowid,name,dosage_form,strength,specification,category_title) "
               "SELECT id,name,dosage_form,strength,specification,category_title FROM emhslu_items")
    db.commit()
    db.execute('VACUUM')
    db.commit()

    print(f'  sections      : {len(section_titles)}')
    print(f'  categories    : {len(cats)}')
    print(f'  items         : {n_items}')
    for t, c in db.execute('SELECT item_type, COUNT(*) FROM emhslu_items GROUP BY 1 ORDER BY 2 DESC'):
        print(f'      {t:<14}: {c}')
    print('  by level      :', db.execute(
        'SELECT level_of_care, COUNT(*) FROM emhslu_items GROUP BY 1 ORDER BY 2 DESC').fetchall())
    print('  by VEN        :', db.execute(
        'SELECT ven_class, COUNT(*) FROM emhslu_items GROUP BY 1 ORDER BY 2 DESC').fetchall())
    print(f'  file size     : {os.path.getsize(dst)/1024/1024:.2f} MB')
    db.close()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
