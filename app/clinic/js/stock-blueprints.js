/* Homatt Health — pack blueprints
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The national list (EMHSLU 2023) tells us WHAT a medicine is — Amoxicillin,
 * Capsule, 250 mg — but it says nothing at all about how it is packed. Not one
 * of its 750 medicines carries a manufacturer, a strip count or a box count;
 * the word "strip" does not appear anywhere in it. Only 26 of the 754 supplies
 * happen to mention a pack size in passing ("Bin liners — Black, pack of 100").
 *
 * So the pack blueprint is built here, from three sources, in this order:
 *
 *   1. What THIS clinic entered last time. Once the owner has told us that
 *      their box of Amoxicillin holds 8 strips, that is the truth for them
 *      forever — no blueprint overrides it. (Kept by stock-intake.js.)
 *   2. A pack size printed in the national list itself, where there is one.
 *   3. The standard presentation for that dosage form — a blister box of
 *      10 strips x 10 tablets, a box of 10 vials, a carton of 20 drip bottles.
 *      This is a STARTING SUGGESTION, always shown, always editable.
 *
 * Nothing here is ever forced on the owner. The sheet shows the sum in full —
 * "5 boxes x 10 strips x 10 tabs = 500 tabs" — so a wrong guess is obvious
 * before it is saved, and correcting it teaches the app for good.
 */
(function () {
  'use strict';

  function s(v) { return String(v == null ? '' : v); }
  function low(v) { return s(v).toLowerCase(); }

  // ── Shelf unit + standard presentation, by dosage form ───────────────────
  // First match wins, so the narrow forms come before the wide ones:
  // "Powder for injection" must be tested before "Powder", "Eye drops" before
  // "drops", "Dispersible tablet" reads as a tablet either way.
  //
  //   strips = how many of the middle layer are in one outer pack
  //   units  = how many shelf-units are in one of the middle layer
  //   inner  = '' when there is no middle layer (a box of vials is just vials)
  var FORMS = [
    { re: /suppositor|pessar|rectal tube/,                unit: 'pieces',  outer: 'boxes',   inner: '',       strips: 1,  units: 10 },
    { re: /implant|vaginal ring|copper *t|iud/,           unit: 'pieces',  outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    { re: /sachet|granule|powder for (solution|1 ?litre)|who formula|bp formula/,
                                                          unit: 'sachets', outer: 'packs',   inner: '',       strips: 1,  units: 10 },
    { re: /powder ?for ?inj|powder ?forinj|sterile concentrate|depot inj|injectable|inject|^inj\b|\binj\b/,
                                                          unit: 'vials',   outer: 'boxes',   inner: '',       strips: 1,  units: 10 },
    { re: /iv ?infusion|infusion|iv ?fluid|intravenous|concentrate for iv/,
                                                          unit: 'bottles', outer: 'cartons', inner: '',       strips: 1,  units: 20 },
    { re: /eye ?\/? ?ear|eye drop|ear drop|nasal drop|nasal spray|ophthalmic|eye ointment|drops/,
                                                          unit: 'bottles', outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    { re: /aerosol|inhal|nebulis|nebuliz|spray/,          unit: 'inhalers',outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    { re: /cream|ointment|gel|paste|lotion|oil\b|tincture|application|topical|antiseptic/,
                                                          unit: 'tubes',   outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    { re: /mouthwash|syrup|suspension|solution|oral liquid|oral emulsion|emulsion|liquid|elixir|aqueous/,
                                                          unit: 'bottles', outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    { re: /capsule|caps\b/,                               unit: 'caps',    outer: 'boxes',   inner: 'strips', strips: 10, units: 10 },
    { re: /tablet|tabs?\b|gum|lozenge/,                   unit: 'tabs',    outer: 'boxes',   inner: 'strips', strips: 10, units: 10 },
    { re: /medical gas|oxygen/,                           unit: 'cylinders', outer: 'cylinders', inner: '',   strips: 1,  units: 1  },
    { re: /gauze|dressing|beads|impregnated/,             unit: 'pieces',  outer: 'packs',   inner: '',       strips: 1,  units: 10 },
    { re: /latex|polyurethne|nitrile/,                    unit: 'pieces',  outer: 'boxes',   inner: '',       strips: 1,  units: 100 },
  ];

  // Fallback when the national list gives no dosage form at all. A medicine
  // with no stated form is, overwhelmingly, a tablet.
  var MED_DEFAULT      = { unit: 'tabs',   outer: 'boxes', inner: 'strips', strips: 10, units: 10 };
  var COMMODITY_DEFAULT = { unit: 'pieces', outer: 'packs', inner: '',      strips: 1,  units: 0  };

  // ── Medicines whose real presentation is NOT the form default ────────────
  // Kept deliberately short: only where the standard pack is genuinely
  // different and getting it wrong would be an obvious annoyance.
  var NAMED = [
    // A course of Coartem is one blister, and the blister size is the weight
    // band. The adult band is 24 tablets.
    { re: /artemether.*lumefantrine|lumefantrine.*artemether|coartem|lumartem|lonart/,
      unit: 'tabs', outer: 'boxes', inner: 'blisters', strips: 30, units: 24,
      note: 'One adult course is a blister of 24 tablets. Change the 24 for a child pack (6, 12 or 18).' },
    // Rectal/injectable artesunate and artemether come in single-course boxes.
    { re: /artesunate/,  unit: 'vials',   outer: 'boxes', inner: '', strips: 1, units: 1,
      note: 'Sold as single vials with their own diluent.' },
    // ORS: the WHO carton is 100 one-litre sachets.
    { re: /oral rehydration|^ors\b|rehydration salt/,
      unit: 'sachets', outer: 'cartons', inner: '', strips: 1, units: 100,
      note: 'The standard carton holds 100 one-litre sachets.' },
    { re: /zinc sulphate|zinc sulfate/,
      unit: 'tabs', outer: 'boxes', inner: 'strips', strips: 10, units: 10 },
    // ── Things that run into a vein ──────────────────────────────────────
    // Counted as they are hung, never as tablets. Order matters: the small
    // concentrated ampoules are matched BEFORE the big drip bags, because
    // "dextrose 50%" is a 50 ml push for hypoglycaemia, not a 500 ml infusion.
    { re: /dextrose\s*50|glucose\s*50|dextrose\s*40/,
      unit: 'vials', outer: 'boxes', inner: '', strips: 1, units: 10,
      note: 'Small concentrated ampoules — given as a slow IV push, not hung as a drip.' },
    { re: /sodium bicarbonate|potassium chloride concentrate|magnesium sulphate|magnesium sulfate|water for injection/,
      unit: 'vials', outer: 'boxes', inner: '', strips: 1, units: 10,
      note: 'Given as an ampoule into a vein or into a running drip.' },
    // The big drip bags are bought by the carton.
    { re: /sodium chloride 0\.9|normal saline|ringer'?s? ?lactate|hartmann|dextrose\s*(5|10)|glucose\s*(5|10)|darrow/,
      unit: 'bottles', outer: 'cartons', inner: '', strips: 1, units: 20,
      note: 'A carton of drip bottles — usually 20 x 500 ml.' },
    // Family planning
    { re: /medroxyprogesterone|depo/, unit: 'vials', outer: 'boxes', inner: '', strips: 1, units: 1 },
  ];

  // ── Things a clinic sells that the national list does not carry ──────────
  // EMHSLU has no pampers and no retail condoms — it is a public-supply list,
  // not a shop list. These are offered by name so the owner never has to fight
  // the search box for the commonest counter sales.
  var COMMODITIES = [
    { name: 'Pampers (baby diapers)',   unit: 'pieces', pack: 'pack',  per: 0,   hint: 'Count the pieces on the packet — packs run 10, 24, 50 or 64.' },
    { name: 'Adult diapers',            unit: 'pieces', pack: 'pack',  per: 0 },
    { name: 'Condoms (male)',           unit: 'pieces', pack: 'packet', per: 3,  hint: 'A retail packet is usually 3.' },
    { name: 'Condoms (female)',         unit: 'pieces', pack: 'packet', per: 2 },
    { name: 'Sanitary pads',            unit: 'pieces', pack: 'packet', per: 10 },
    { name: 'Baby wipes',               unit: 'packs',  pack: 'carton', per: 12 },
    { name: 'Cotton wool',              unit: 'rolls',  pack: 'pack',   per: 1 },
    { name: 'Surgical spirit',          unit: 'bottles',pack: 'box',    per: 1 },
    { name: 'Gauze bandage',            unit: 'rolls',  pack: 'pack',   per: 12 },
    { name: 'Adhesive plaster',         unit: 'pieces', pack: 'box',    per: 100 },
    { name: 'Examination gloves',       unit: 'pieces', pack: 'box',    per: 100, hint: 'A box of exam gloves is 100 pieces (50 pairs).' },
    { name: 'Surgical gloves (sterile)',unit: 'pairs',  pack: 'box',    per: 50 },
    { name: 'Face masks',               unit: 'pieces', pack: 'box',    per: 50 },
    { name: 'Hand sanitiser',           unit: 'bottles',pack: 'box',    per: 1 },
    { name: 'Syringe 5 ml',             unit: 'pieces', pack: 'box',    per: 100 },
    { name: 'Syringe 10 ml',            unit: 'pieces', pack: 'box',    per: 100 },
    { name: 'Pregnancy test strips',    unit: 'strips', pack: 'box',    per: 25 },
    { name: 'Malaria rapid test (RDT)', unit: 'tests',  pack: 'box',    per: 25 },
    { name: 'Blood sugar test strips',  unit: 'strips', pack: 'box',    per: 50 },
    { name: 'Mosquito net',             unit: 'pieces', pack: 'bale',   per: 0 },
    { name: 'Vaseline / petroleum jelly', unit: 'tubs', pack: 'box',    per: 1 },
    { name: 'Thermometer',              unit: 'pieces', pack: 'box',    per: 0 },
  ];

  // ── A pack size actually printed in the national list ─────────────────────
  // "Black, pack of 100" → 100.  "Roll, 25 m" → not a count, ignored.
  function parseSpecPack(spec) {
    var t = low(spec);
    if (!t) return 0;
    var m = t.match(/pack(?:et)?\s*of\s*(\d{1,4})/) ||
            t.match(/box\s*of\s*(\d{1,4})/) ||
            t.match(/(\d{1,4})\s*(?:sachets|pieces|pcs|tablets|tabs)\s*(?:per|\/)?\s*(?:pack|box)/);
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return (isFinite(n) && n > 1 && n <= 5000) ? n : 0;
  }

  function formRule(form) {
    var f = low(form);
    if (!f) return null;
    for (var i = 0; i < FORMS.length; i++) if (FORMS[i].re.test(f)) return FORMS[i];
    return null;
  }

  function namedRule(name) {
    var n = low(name);
    if (!n) return null;
    for (var i = 0; i < NAMED.length; i++) if (NAMED[i].re.test(n)) return NAMED[i];
    return null;
  }

  /* The blueprint for one item.
   *
   *   blueprintFor({ name, form, itemType, spec })
   *     → { kind, unit, outer, inner, strips, units, total, note, sure }
   *
   *   kind    'medicine' | 'commodity'
   *   unit    what sits on the shelf and is dispensed — tabs, ml, pieces
   *   outer   what the delivery arrives in — boxes, cartons, packs
   *   inner   the middle layer, or '' when there isn't one
   *   strips  how many inner per outer   (1 when there is no middle layer)
   *   units   how many shelf-units per inner
   *   sure    true when we recognised the item; false when this is only the
   *           usual shape for that kind of thing and wants checking
   */
  function blueprintFor(o) {
    o = o || {};
    var name = s(o.name), form = s(o.form), spec = s(o.spec);
    var type = low(o.itemType) || (form ? 'medicine' : '');
    var isMed = type === 'medicine' || (!type && !!formRule(form));

    // 1. A commodity we ship a hint for. An exact name wins outright — matching
    //    on the leading word alone would hand "Condoms (female)" the male entry,
    //    which packs three to a packet rather than two.
    var lowName = low(name);
    var hit = null;
    for (var i = 0; i < COMMODITIES.length; i++) {
      if (low(COMMODITIES[i].name) === lowName) { hit = COMMODITIES[i]; break; }
    }
    if (!hit) {
      for (var j = 0; j < COMMODITIES.length; j++) {
        var head = low(COMMODITIES[j].name).split(' (')[0];
        if (head.length > 3 && lowName.indexOf(head) === 0) { hit = COMMODITIES[j]; break; }
      }
    }
    if (hit) {
      return {
        kind: 'commodity', unit: hit.unit, outer: hit.pack + 's', inner: '',
        strips: 1, units: hit.per || 0, note: hit.hint || '', sure: !!hit.per,
      };
    }

    // 2. A medicine whose real pack we know by name.
    var nr = isMed ? namedRule(name) : null;
    if (nr) {
      return { kind: 'medicine', unit: nr.unit, outer: nr.outer, inner: nr.inner,
               strips: nr.strips, units: nr.units, note: nr.note || '', sure: true };
    }

    // 3. A pack size the national list actually prints.
    var printed = parseSpecPack(spec);

    // 4. The standard presentation for the dosage form.
    var fr = formRule(form);
    if (isMed) {
      var base = fr || MED_DEFAULT;
      return {
        kind: 'medicine', unit: base.unit, outer: base.outer, inner: base.inner,
        strips: base.strips, units: printed || base.units,
        note: printed ? 'Pack size taken from the national list.' : '',
        sure: !!printed,
      };
    }
    return {
      kind: 'commodity', unit: (fr && fr.unit) || COMMODITY_DEFAULT.unit,
      outer: COMMODITY_DEFAULT.outer, inner: '',
      strips: 1, units: printed || (fr ? fr.units : 0),
      note: printed ? 'Pack size taken from the national list.' : '',
      sure: !!printed,
    };
  }

  // ── The shape implied by a unit already on the shelf ─────────────────────
  // An item stocked before the pack shape was ever recorded knows only what it
  // is counted in. That alone says most of it: nobody buys vials in strips.
  var BY_UNIT = {
    tabs:   { outer: 'boxes',   inner: 'strips', strips: 10, units: 10 },
    tab:    { outer: 'boxes',   inner: 'strips', strips: 10, units: 10 },
    caps:   { outer: 'boxes',   inner: 'strips', strips: 10, units: 10 },
    tablets:{ outer: 'boxes',   inner: 'strips', strips: 10, units: 10 },
    vials:  { outer: 'boxes',   inner: '',       strips: 1,  units: 10 },
    amps:   { outer: 'boxes',   inner: '',       strips: 1,  units: 10 },
    ampoules:{outer: 'boxes',   inner: '',       strips: 1,  units: 10 },
    sachets:{ outer: 'packs',   inner: '',       strips: 1,  units: 10 },
    bottles:{ outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    tubes:  { outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    inhalers:{outer: 'boxes',   inner: '',       strips: 1,  units: 1  },
    cylinders:{outer:'cylinders',inner:'',       strips: 1,  units: 1  },
    ml:     { outer: 'bottles', inner: '',       strips: 1,  units: 0  },
  };
  // Anything counted one-by-one off a shelf: pieces, pairs, rolls, tests…
  var LOOSE = { outer: 'packs', inner: '', strips: 1, units: 0 };

  function shapeForUnit(unit) {
    var u = low(unit).trim();
    if (!u) return null;
    if (BY_UNIT[u]) return Object.assign({ unit: u }, BY_UNIT[u]);
    return Object.assign({ unit: u }, LOOSE);
  }

  // Just the shelf unit — used where only the word is needed.
  function unitFor(form, itemType, name) {
    return blueprintFor({ name: name, form: form, itemType: itemType }).unit;
  }

  // Is this something the clinic SELLS, or an internal supply?
  // Everything a clinic buys can be sold; "material" is chosen by hand in the
  // stock tracker, never inferred here. Medicines stay medicines, everything
  // else is a consumable so it still reaches Quick Sale.
  function typeFor(emhsluType) {
    return low(emhsluType) === 'medicine' ? 'medicine' : 'consumable';
  }

  // The built-in commodity names, for the picker.
  function commodities(q) {
    var t = low(q);
    return COMMODITIES.filter(function (c) {
      return !t || low(c.name).indexOf(t) >= 0;
    }).map(function (c) { return { name: c.name, unit: c.unit }; });
  }

  window.StockBlueprint = {
    blueprintFor: blueprintFor,
    shapeForUnit: shapeForUnit,
    unitFor: unitFor,
    typeFor: typeFor,
    commodities: commodities,
    parseSpecPack: parseSpecPack,
  };
})();
