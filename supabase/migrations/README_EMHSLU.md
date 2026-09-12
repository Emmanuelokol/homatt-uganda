# EMHSLU 2023 — how to load it into Supabase

Four files, run **in this order**, each one on its own in the
**Supabase → SQL Editor**. Paste one, press Run, wait for it to finish, then
move to the next.

| # | File | Size | What it does |
|---|------|------|--------------|
| 1 | `20260823_emhslu_schema.sql` | 12 KB | Creates the tables, the patient identifier, the facility level and the care-packages table |
| 2 | `20260823_emhslu_seed_1_reference.sql` | 16 KB | 4 sections, 303 categories |
| 3 | `20260823_emhslu_seed_2_items.sql` | 172 KB | Items 1 … 1200 |
| 4 | `20260823_emhslu_seed_3_items.sql` | 191 KB | Items 1201 … 2424, then builds the level table and prints a check |

Running any file a second time is safe — nothing is duplicated.

The last file finishes by printing a count. It should say:

```
sections     4
categories   303
items        2424
medicines    750
level rows   7712
```

and then `Amoxicillin | Capsule | 250 mg | HC2 | V`.

If you see those numbers, it loaded correctly.

---

## What you get

**`emhslu_items`** — 2,424 items from the national list: 750 medicines,
754 health supplies, 920 laboratory supplies. Each has its official name,
dosage form, strength, the lowest facility level allowed to stock it, and its
VEN class (V = vital, E = essential, N = necessary).

**`emhslu_item_levels`** — spells out that a drug allowed at HC2 is also
allowed at HC3, HC4, hospital and referral level, so "what may my level stock?"
is one fast lookup.

**`clinics.facility_level`** — a new column holding HC1 … NR. Set it from
**Clinic Profile → Facility Level** in the app.

**`clinic_care_packages`** — the table the one-tap package has been trying to
write to. It was missing, so every clinic's learned packages were staying on
the one phone. After this, they follow the clinic across its devices.

**`homatt_patient_id(text)`** — the HP-XXXXXX patient code, in SQL. It gives
exactly the same answer as the app does on the phone, so the server and every
device always agree, online or offline. Verified against the app across 2,000
cases.

---

## Things you can now ask the database

```sql
-- Everything an HC III may stock
select * from emhslu_for_my_level('medicine', 'HC3');

-- Type-ahead search, with a warning flag for drugs above your level
select * from emhslu_search('amo', 'medicine', 'HC2');

-- A patient's code
select homatt_patient_id('0788099425');   -- HP-TIQH9X

-- Vital medicines an HC II should never run out of
select i.name, i.strength
  from emhslu_item_levels l join emhslu_items i on i.id = l.item_id
 where l.level = 'HC2' and i.ven_class = 'V' and i.item_type = 'medicine'
 order by i.name;
```

---

## Rebuilding the files

The SQL is generated from the bundled SQLite database, so the two can never
drift apart:

```bash
python3 tools/build_emhslu_db.py <EMHSLU markdown> app/clinic/data/emhslu_2023.db
python3 tools/emhslu_to_sql.py app/clinic/data/emhslu_2023.db supabase/migrations/
```
