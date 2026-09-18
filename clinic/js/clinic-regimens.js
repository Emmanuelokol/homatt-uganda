/* Homatt Health — one place that knows what a dose looks like
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The treatment screen has known these regimens since it was written. The
 * follow-up visit on the dashboard did not: it offered three empty boxes and
 * asked the clinician to remember the dose, on the one screen where they are
 * adding a medicine to somebody already diagnosed.
 *
 * The obvious fix — copy the table into the dashboard — is the one this
 * project has learnt not to make. "Two separate implementations would drift,
 * and the second one would be the one nobody measured" is written about the
 * microphone, and it is truer of a dose: the day somebody corrects
 * amoxicillin in one file and not the other, two screens in the same app
 * prescribe two different things and neither looks wrong.
 *
 * So the table moved HERE, and both read it.
 *
 * WHAT IT IS AND IS NOT
 * ---------------------
 * It is a short list of the medicines a Ugandan clinic reaches for most, with
 * the dose the guidelines give for an adult, a child and an infant. It is a
 * STARTING POINT the clinician edits, never a prescription: every screen that
 * uses it shows the figure in an editable box and says where it came from.
 *
 * It is not the Uganda Clinical Guidelines. The book is 4 MB and is read by
 * the one-tap package on the treatment screen, which quotes it with its page.
 * This is the quick answer for the commonest twenty-odd drugs, and it carries
 * the same rule the rest of the app follows: a child never silently gets an
 * adult dose — the band is chosen from the recorded age, and where only an
 * adult figure exists the caller is told so rather than given it quietly.
 */
(function (root) {
  'use strict';

var DRUG_REGIMENS = [
  { match:['paracetamol','panadol','acetaminophen'],
    adult:{dose:'1g (2 tabs of 500mg)', times:3, days:3},
    child:{dose:'15mg/kg per dose (syrup 120mg/5ml)', times:3, days:3, wt:true},
    infant:{dose:'15mg/kg (syrup 120mg/5ml)', times:3, days:3, wt:true} },
  { match:['coartem','artemether','lumefantrine','duo-cotecxin','artefan'],
    adult:{dose:'4 tabs per dose',      times:2, days:3},
    child:{dose:'1–3 tabs per dose by weight (5–14kg:1, 15–24kg:2, 25–34kg:3)', times:2, days:3, wt:true},
    infant:{dose:'1 tab per dose (5–14kg)', times:2, days:3, wt:true} },
  { match:['amoxicillin','amoxil','amoxyl'],
    adult:{dose:'500mg',               times:3, days:5},
    child:{dose:'25mg/kg per dose (syrup 250mg/5ml)', times:3, days:5, wt:true},
    infant:{dose:'62.5–125mg (syrup 125mg/5ml)', times:3, days:5, wt:true} },
  { match:['metronidazole','flagyl'],
    adult:{dose:'400mg',               times:3, days:7},
    child:{dose:'7.5mg/kg per dose',   times:3, days:7, wt:true} },
  { match:['ciprofloxacin','cipro'],
    adult:{dose:'500mg',               times:2, days:7, preg:true} },
  { match:['doxycycline','doxy'],
    adult:{dose:'100mg',               times:2, days:7, preg:true} },
  { match:['cotrimoxazole','septrin','co-trimoxazole','bactrim'],
    adult:{dose:'960mg (2 tabs of 480mg)', times:2, days:5},
    child:{dose:'24mg/kg per dose (syrup 240mg/5ml)', times:2, days:5, wt:true},
    infant:{dose:'120mg (syrup 2.5ml)', times:2, days:5} },
  { match:['azithromycin','zithromax'],
    adult:{dose:'500mg',               times:1, days:3},
    child:{dose:'10mg/kg',             times:1, days:3, wt:true} },
  { match:['erythromycin'],
    adult:{dose:'500mg',               times:4, days:5},
    child:{dose:'12.5mg/kg per dose',  times:4, days:5, wt:true} },
  { match:['ibuprofen','brufen'],
    adult:{dose:'400mg',               times:3, days:3},
    child:{dose:'10mg/kg (syrup 100mg/5ml)', times:3, days:3, wt:true, preg:false} },
  { match:['diclofenac'],
    adult:{dose:'50mg',                times:2, days:5, preg:true} },
  { match:['ors','oral rehydration'],
    adult:{dose:'1 sachet in 1L water, after each loose stool', times:3, days:3},
    child:{dose:'½–1 sachet, after each loose stool', times:3, days:3},
    infant:{dose:'¼–½ sachet, 5ml/kg after each stool', times:3, days:3, wt:true} },
  { match:['zinc'],
    adult:{dose:'20mg',                times:1, days:10},
    child:{dose:'20mg (10mg if under 6 months)', times:1, days:10},
    infant:{dose:'10mg',               times:1, days:10} },
  { match:['cetirizine','zyrtec'],
    adult:{dose:'10mg',                times:1, days:5},
    child:{dose:'5mg (syrup 5ml)',     times:1, days:5} },
  { match:['chlorpheniramine','piriton'],
    adult:{dose:'4mg',                 times:3, days:5},
    child:{dose:'1–2mg (syrup 2.5–5ml)', times:2, days:5} },
  { match:['omeprazole','losec'],
    adult:{dose:'20mg',                times:1, days:14} },
  { match:['metformin','glucophage'],
    adult:{dose:'500mg',               times:2, days:30} },
  { match:['amlodipine','norvasc'],
    adult:{dose:'5mg',                 times:1, days:30} },
  { match:['albendazole','zentel'],
    adult:{dose:'400mg single dose',   times:1, days:1, preg:true},
    child:{dose:'400mg single dose (200mg if 1–2 yrs)', times:1, days:1} },
  { match:['mebendazole','vermox'],
    adult:{dose:'100mg',               times:2, days:3, preg:true},
    child:{dose:'100mg',               times:2, days:3} },
  { match:['fluconazole','diflucan'],
    adult:{dose:'150mg single dose',   times:1, days:1, preg:true} },
  { match:['ferrous','iron'],
    adult:{dose:'200mg',               times:1, days:30},
    child:{dose:'3mg/kg elemental iron (syrup)', times:1, days:30, wt:true} },
  { match:['folic'],
    adult:{dose:'5mg',                 times:1, days:30} },
  { match:['vitamin c','ascorbic'],
    adult:{dose:'1 tab',               times:1, days:7},
    child:{dose:'1 tab',               times:1, days:7} },
  { match:['salbutamol','ventolin'],
    adult:{dose:'4mg (or 2 puffs inhaler)', times:3, days:5},
    child:{dose:'2mg (syrup 5ml) or 1–2 puffs', times:3, days:5} },
  // ── Additional common Uganda OPD drugs ──
  { match:['nystatin'],
    adult:{dose:'1–2 tabs / 5ml suspension', times:4, days:7},
    child:{dose:'1ml suspension to each side of mouth', times:4, days:7},
    infant:{dose:'1ml suspension', times:4, days:7} },
  { match:['nifedipine'],
    adult:{dose:'20mg',                times:2, days:30} },
  { match:['hydrochlorothiazide','hctz'],
    adult:{dose:'25mg',                times:1, days:30} },
  { match:['prednisolone','prednisone'],
    adult:{dose:'30–40mg',             times:1, days:5},
    child:{dose:'1mg/kg',              times:1, days:5, wt:true} },
  { match:['dexamethasone'],
    adult:{dose:'4mg',                 times:1, days:3},
    child:{dose:'0.15mg/kg',           times:1, days:3, wt:true} },
  { match:['hyoscine','buscopan'],
    adult:{dose:'10mg',                times:3, days:3} },
  { match:['loratadine','clarityne'],
    adult:{dose:'10mg',                times:1, days:5},
    child:{dose:'5mg (syrup 5ml)',     times:1, days:5} },
  { match:['ranitidine','zantac'],
    adult:{dose:'150mg',               times:2, days:14} },
  { match:['ceftriaxone'],
    adult:{dose:'1–2g IV/IM',          times:1, days:5},
    child:{dose:'50–80mg/kg IV/IM',    times:1, days:5, wt:true} },
  { match:['benzylpenicillin','crystalline penicillin'],
    adult:{dose:'2–4 MU IV',           times:4, days:5},
    child:{dose:'50,000 IU/kg IV',     times:4, days:5, wt:true} },
  { match:['gentamicin'],
    adult:{dose:'5–7mg/kg IV/IM',      times:1, days:5, wt:true},
    child:{dose:'7.5mg/kg IV/IM',      times:1, days:5, wt:true} },
  { match:['nevirapine','dolutegravir','tenofovir','efavirenz','tld'],
    adult:{dose:'As per national ART guidelines — confirm regimen', times:1, days:30} },
  { match:['quinine'],
    adult:{dose:'600mg',               times:3, days:7},
    child:{dose:'10mg/kg per dose',    times:3, days:7, wt:true} },
  { match:['artesunate'],
    adult:{dose:'2.4mg/kg IV at 0,12,24h then daily', times:1, days:3, wt:true},
    child:{dose:'3mg/kg IV (under 20kg)', times:1, days:3, wt:true} },
]
  /* The regimen for a drug name, or null. Matched on a substring so the
     brand names a clinic actually writes ("Panadol", "Septrin", "Coartem")
     find the generic. Three characters minimum: fewer matches half the list. */
  function find(name) {
    var n = String(name || '').toLowerCase();
    if (n.length < 3) return null;
    for (var i = 0; i < DRUG_REGIMENS.length; i++) {
      var r = DRUG_REGIMENS[i];
      for (var k = 0; k < r.match.length; k++) {
        if (n.indexOf(r.match[k]) >= 0) return r;
      }
    }
    return null;
  }

  /* The dose for an age band, and WHICH band it actually came from.
   *
   * `usedBand` is the part that matters. Falling back to the adult figure for
   * a child is often the only thing available, and it is safe ONLY if the
   * screen says so — "adult dose, verify for this age" — which is why this
   * returns the band it used rather than quietly handing back a number. */
  function forBand(reg, band) {
    if (!reg) return null;
    var r, used;
    if (band === 'infant')     { r = reg.infant || reg.child || reg.adult; used = reg.infant ? 'infant' : (reg.child ? 'child' : 'adult'); }
    else if (band === 'child') { r = reg.child  || reg.adult;              used = reg.child  ? 'child'  : 'adult'; }
    else                       { r = reg.adult;                            used = 'adult'; }
    if (!r) return null;
    return { dose: r.dose, times: r.times, days: r.days,
             byWeight: !!r.wt, pregnancyCaution: !!r.preg, usedBand: used };
  }

  // "three times daily" / "bd" / "every 8 hours" -> 1-4
  function timesPerDay(text) {
    var t = String(text || '').toLowerCase();
    if (/four times|4 times|\bqid\b|\bqds\b|every 6 ?h/.test(t)) return 4;
    if (/three times|3 times|\btds\b|\btid\b|every 8 ?h/.test(t)) return 3;
    if (/twice|two times|2 times|\bbd\b|\bbid\b|every 12 ?h/.test(t)) return 2;
    if (/once|one time|1 time|\bod\b|single dose|\bstat\b/.test(t)) return 1;
    return null;
  }

  /* Every name this table knows, for a suggestion list. The first match word
     is the generic and leads; the rest are the brands, shown after it so a
     clinician typing "panadol" sees that it is paracetamol. */
  function names() {
    return DRUG_REGIMENS.map(function (r) {
      return { generic: r.match[0], also: r.match.slice(1),
               adult: r.adult && r.adult.dose || '' };
    });
  }

  root.HomattRegimens = {
    all: DRUG_REGIMENS,
    find: find,
    forBand: forBand,
    timesPerDay: timesPerDay,
    names: names,
  };
})(typeof window !== 'undefined' ? window : this);
