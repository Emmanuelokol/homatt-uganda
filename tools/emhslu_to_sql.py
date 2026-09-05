#!/usr/bin/env python3
"""
Emit paste-ready Postgres seed files from app/clinic/data/emhslu_2023.db.

The Supabase SQL editor is happiest with a few hundred KB at a time, so the
2,424 items are split across two files. The level-expansion table is derived
in SQL at the end rather than seeded row by row.

Usage: python3 emhslu_to_sql.py <emhslu.db> <out_dir>
"""
import os
import sqlite3
import sys

SPLIT_AT = 1200          # items per file


def q(v):
    """SQL literal."""
    if v is None or v == '':
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def qb(v):
    return 'true' if v else 'false'


def header(n, of, title, note=''):
    return (
        '-- ' + '=' * 73 + '\n'
        f'-- CHUNK {n} of {of} — {title}\n'
        '--\n'
        '-- Essential Medicines & Health Supplies List for Uganda (EMHSLU 2023).\n'
        '-- Run 20260823_emhslu_schema.sql FIRST, then these in order.\n'
        + (f'--\n-- {note}\n' if note else '') +
        '-- Safe to re-run: every insert is ON CONFLICT DO NOTHING.\n'
        '-- ' + '=' * 73 + '\n\n'
    )


def main(src, out_dir):
    db = sqlite3.connect(src)
    db.row_factory = sqlite3.Row
    os.makedirs(out_dir, exist_ok=True)

    # ── Chunk 2: sections + categories ────────────────────────────────────
    p = os.path.join(out_dir, '20260823_emhslu_seed_1_reference.sql')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(header(2, 4, 'REFERENCE (sections and categories)'))
        f.write('insert into public.emhslu_sections (code, title) values\n')
        rows = db.execute('SELECT code, title FROM emhslu_sections ORDER BY code').fetchall()
        f.write(',\n'.join(f'  ({q(r["code"])}, {q(r["title"])})' for r in rows))
        f.write('\non conflict (code) do update set title = excluded.title;\n\n')

        f.write('insert into public.emhslu_categories (id, section, number, title) values\n')
        rows = db.execute(
            'SELECT id, section, number, title FROM emhslu_categories ORDER BY id').fetchall()
        f.write(',\n'.join(
            f'  ({r["id"]}, {q(r["section"])}, {q(r["number"])}, {q(r["title"])})' for r in rows))
        f.write('\non conflict (id) do update set '
                'section = excluded.section, number = excluded.number, title = excluded.title;\n\n')
        f.write(f'-- {len(rows)} categories\n')
    print(p, f'{os.path.getsize(p)/1024:.0f} KB')

    # ── Chunks 3 & 4: the items ───────────────────────────────────────────
    items = db.execute(
        'SELECT id, section, category_id, category_number, category_title, item_type, '
        'name, dosage_form, strength, specification, level_of_care, ven_class, specialist '
        'FROM emhslu_items ORDER BY id').fetchall()

    parts = [items[:SPLIT_AT], items[SPLIT_AT:]]
    for idx, part in enumerate(parts):
        n = 3 + idx
        last = (idx == len(parts) - 1)
        name = f'20260823_emhslu_seed_{2 + idx}_items.sql'
        p = os.path.join(out_dir, name)
        lo, hi = part[0]['id'], part[-1]['id']
        with open(p, 'w', encoding='utf-8') as f:
            f.write(header(n, 4, f'ITEMS {lo} … {hi}',
                           f'{len(part)} of {len(items)} items.'))
            f.write('insert into public.emhslu_items\n'
                    '  (id, section, category_id, category_number, category_title, item_type,\n'
                    '   name, dosage_form, strength, specification, level_of_care, ven_class,\n'
                    '   specialist) values\n')
            f.write(',\n'.join(
                f'  ({r["id"]}, {q(r["section"])}, '
                f'{r["category_id"] if r["category_id"] is not None else "null"}, '
                f'{q(r["category_number"])}, {q(r["category_title"])}, {q(r["item_type"])}, '
                f'{q(r["name"])}, {q(r["dosage_form"])}, {q(r["strength"])}, '
                f'{q(r["specification"])}, {q(r["level_of_care"])}, {q(r["ven_class"])}, '
                f'{qb(r["specialist"])})' for r in part))
            f.write('\non conflict (id) do update set\n'
                    '  name = excluded.name, dosage_form = excluded.dosage_form,\n'
                    '  strength = excluded.strength, specification = excluded.specification,\n'
                    '  level_of_care = excluded.level_of_care, ven_class = excluded.ven_class,\n'
                    '  category_id = excluded.category_id, item_type = excluded.item_type;\n')

            if last:
                f.write("""
-- ── Level expansion ───────────────────────────────────────────────────────
-- An item allowed at HC2 is also allowed at HC3, HC4, H, RR and NR. Derived
-- here rather than seeded, so it can never drift from the items above.
truncate table public.emhslu_item_levels;

insert into public.emhslu_item_levels (item_id, level)
select i.id, l.level
  from public.emhslu_items i
  join (values ('HC1',1),('HC2',2),('HC3',3),('HC4',4),
               ('H',5),('RR',6),('NR',7)) as l(level, ord)
    on l.ord >= (case i.level_of_care
                   when 'HC1' then 1 when 'HC2' then 2 when 'HC3' then 3
                   when 'HC4' then 4 when 'H'   then 5 when 'RR'  then 6
                   when 'NR'  then 7 end)
 where i.level_of_care is not null
on conflict do nothing;

-- ── Check it landed ───────────────────────────────────────────────────────
select 'sections'   as what, count(*) from public.emhslu_sections
union all select 'categories',  count(*) from public.emhslu_categories
union all select 'items',       count(*) from public.emhslu_items
union all select 'medicines',   count(*) from public.emhslu_items where item_type='medicine'
union all select 'level rows',  count(*) from public.emhslu_item_levels;

-- Should return: Amoxicillin | Capsule | 250 mg | HC2 | V
select name, dosage_form, strength, level_of_care, ven_class
  from public.emhslu_items
 where item_type = 'medicine' and name ilike 'amoxicillin'
 order by length(strength), strength
 limit 3;
""")
        print(p, f'{os.path.getsize(p)/1024:.0f} KB', f'({len(part)} items)')
    db.close()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
