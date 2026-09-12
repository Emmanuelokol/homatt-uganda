/* Homatt Health — where one section of the guideline stops being itself
 *
 * WHY THIS EXISTS
 * ---------------
 * The one-tap package reads `medicines WHERE condition_id = ?` and offers
 * every row as that condition's drug — with a dose, ticked or not, priced,
 * prescribed and written onto the visit. So "is this drug printed under this
 * heading in the book?" is not a tidiness question. It is the question.
 *
 * Measured over all 1,008 medicine rows (tests/measure-doses.js):
 *
 *   source line verbatim in its own section : 1008 of 1008
 *   dose readable in that line              :  982 of 982
 *   route readable in that line             :  all
 *   MEDICINES PRINTED UNDER ANOTHER HEADING :   26
 *
 * The first three lines are why this fault was invisible. Every row IS a real
 * line of the book, and it IS inside the full_text of the condition it is
 * filed under — because that condition's text ran past its own section and
 * swallowed six more. One section in 551 does this, and it is "9.2.4.1
 * Postnatal Psychosis" (p.522, 21,058 characters where its neighbours are
 * two or three thousand), which absorbed Anxiety, Depression, Postnatal
 * Depression, Suicidal Behaviour, Bipolar Disorder and Psychosis.
 *
 * The result was that typing "postnatal psychosis" — a woman who has just
 * given birth and is breastfeeding — offered a package containing lithium,
 * carbamazepine, clozapine, alprazolam, fluoxetine and bupropion, gathered
 * from four different sections, none of them hers.
 *
 * HOW IT IS FOUND
 * ---------------
 * A numbered heading part-way down a section's text, whose number AND title
 * both belong to a different section the book really has. Both halves are
 * required, and the title check is the important one: "Benzathine penicillin
 * 2.4 MU IM single dose" wrapping onto a new line is indistinguishable from a
 * heading numbered "2.4", and reading it as one would condemn the whole
 * genital ulcer disease page and the congenital syphilis page with it. That
 * is exactly what a looser rule did on the first attempt.
 *
 * It fails by finding too FEW boundaries, which is the safe direction: a
 * medicine left attributed to its host is the state we were already in.
 *
 * WHAT CALLERS DO WITH IT
 * -----------------------
 * Nothing is deleted and nothing is rewritten. The medicine is marked with
 * the heading the book actually prints it under, and it is the caller's job
 * to stop offering it as this condition's treatment while still saying it is
 * there. A drug silently vanishing is its own kind of wrong.
 */
(function (root) {
  'use strict';

  // A numbered heading at the start of a line: "9.2.1 Anxiety ICD10 CODE: …"
  var HEAD = /(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){1,3})[ \t]+([A-Z][^\n]{2,80})/g;

  function tight(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function flat(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /* Every point in `cond.full_text` where the text stops being this section.
   *
   *   cond      {id, number, title, full_text}
   *   lookup    function(number, headingText) -> one of
   *               {id, title}            a section that has its own row. The
   *                                      heading's words are checked against
   *                                      that title here.
   *               {title, buried:true}   a real heading of the book with NO
   *                                      row — the caller has already decided
   *                                      (same test as findBuried()), and it
   *                                      is trusted.
   *               null                   not a heading.
   *             Supplied by the caller so this file needs no database.
   *
   * Returns [{at, number, title, id}], in order. Empty for 548 of the 551
   * sections, which is the point: this costs nothing almost everywhere.
   *
   * Both kinds carry medicines. Oesophageal Varices has no row of its own and
   * its propranolol was filed under Hepatic Encephalopathy; Alcohol Use
   * Disorders likewise, and its thiamine went to Postnatal Psychosis. Exactly
   * two rows book-wide, and no false positives — the app already lists these
   * seven buried headings as real sections on its contents page, so treating
   * them as boundaries here is the same decision made twice, not a new guess.
   */
  function boundaries(cond, lookup) {
    var text = String((cond && cond.full_text) || '');
    if (!text || typeof lookup !== 'function') return [];
    var own = String((cond && cond.number) || '');
    var out = [];
    HEAD.lastIndex = 0;
    var m;
    while ((m = HEAD.exec(text)) !== null) {
      var num = m[1];
      if (num === own) continue;
      var t = m[2].replace(/\s*ICD[- ]?10.*$/i, '').replace(/\s*CODE:.*$/i, '').trim();
      var other = null;
      try { other = lookup(num, t); } catch (e) { other = null; }
      if (!other || !other.title) continue;
      if (cond.id != null && other.id != null && String(other.id) === String(cond.id)) continue;
      // For a section that HAS a row, the heading's words must BE that
      // section's title, not merely sit beside its number. This is the half
      // that keeps a wrapped dose from reading as a heading: "Benzathine
      // penicillin 2.4 MU IM single dose" breaking across a line is
      // indistinguishable from a heading numbered 2.4, and without this it
      // condemned the whole genital ulcer disease page.
      if (!other.buried && tight(t).indexOf(tight(other.title).slice(0, 12)) !== 0) continue;
      out.push({ at: m.index, number: num, title: other.title,
                 id: other.id == null ? null : other.id, buried: !!other.buried });
    }
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /* Mark each row with the heading the book prints it under, when that is not
   * the heading it is filed under. Rows are returned in the same order, each
   * with `printedUnder` set or left undefined.
   *
   * `lineOf(row)` says which field holds the book's own line — source_line
   * for a medicine, and whatever the caller uses for anything else.
   */
  function attribute(cond, list, lookup, lineOf) {
    var bounds = boundaries(cond, lookup);
    if (!bounds.length) return list || [];
    var text = String((cond && cond.full_text) || '');
    var get = lineOf || function (r) { return r && r.source_line; };
    return (list || []).map(function (r) {
      var line = String(get(r) || '');
      if (!line) return r;
      var at = text.indexOf(line);
      // The line may have been reflowed on its way into the row; try again
      // with the whitespace flattened before giving up.
      if (at < 0) {
        var fl = flat(text).indexOf(flat(line));
        if (fl < 0) return r;
        // Flattened offsets are not raw offsets, so compare in flattened
        // space for the boundaries too.
        var fb = bounds.filter(function (b) {
          return flat(text.slice(0, b.at)).length <= fl;
        }).pop();
        if (!fb) return r;
        r.printedUnder = fb;
        return r;
      }
      var owner = bounds.filter(function (b) { return b.at <= at; }).pop();
      if (owner) r.printedUnder = owner;
      return r;
    });
  }

  root.HomattUcgSections = { boundaries: boundaries, attribute: attribute };
})(typeof window !== 'undefined' ? window : this);
