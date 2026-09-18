#!/usr/bin/env python3
"""Replace hardcoded colour literals with the theme tokens that already carry
the same value in light mode.

Why this is safe: every literal in MAP below is EXACTLY the light-mode value of
the token it is replaced with (--text is #1A1A1A, --text-lt is #5F6368,
--border is #E0E0E0, --surface is #FFFFFF). So light mode renders identically,
byte for byte, and dark mode stops painting dark-grey words onto a dark card.

What it deliberately leaves alone:
  • anything inside a rule already scoped to [data-theme="dark"] or
    [data-skin=...] — those literals are the deliberate dark-mode answer;
  • --token: definitions, which are where literals belong;
  • `color:#fff`, which is nearly always white text on a coloured fill and has
    nothing to do with the page theme.

    python3 tools/tokenise_colours.py --check    say what would change
    python3 tools/tokenise_colours.py            change it
"""
import re, sys, glob, collections

# literal -> token, grouped by the property it is legitimate for.
TEXT = {
    '#9aa0a6': 'var(--text-lt, #5F6368)', '#5f6368': 'var(--text-lt, #5F6368)',
    '#bdbdbd': 'var(--text-lt, #5F6368)', '#757575': 'var(--text-lt, #5F6368)',
    '#616161': 'var(--text-lt, #5F6368)', '#80868b': 'var(--text-lt, #5F6368)',
    '#424242': 'var(--text, #1A1A1A)', '#202124': 'var(--text, #1A1A1A)',
    '#212121': 'var(--text, #1A1A1A)', '#1a1a1a': 'var(--text, #1A1A1A)',
    '#111': 'var(--text, #1A1A1A)', '#000': 'var(--text, #1A1A1A)', '#333': 'var(--text, #1A1A1A)',
    '#2c3035': 'var(--text, #1A1A1A)',
}
BG = {
    '#fff': 'var(--surface, #FFFFFF)', '#ffffff': 'var(--surface, #FFFFFF)',
    '#fafafa': 'var(--bg, #F5F5F5)', '#f5f5f5': 'var(--bg, #F5F5F5)', '#f0f4f9': 'var(--bg, #F5F5F5)',
    '#f8f9fa': 'var(--bg, #F5F5F5)', '#f1f3f4': 'var(--bg, #F5F5F5)',
}
LINE = {
    '#e0e0e0': 'var(--border, #E0E0E0)', '#e8eaed': 'var(--border, #E0E0E0)',
    '#f0f0f0': 'var(--border, #E0E0E0)', '#eee': 'var(--border, #E0E0E0)',
    '#eeeeee': 'var(--border, #E0E0E0)', '#dadce0': 'var(--border, #E0E0E0)',
    '#f5f5f5': 'var(--border, #E0E0E0)', '#ececec': 'var(--border, #E0E0E0)',
}
BY_PROP = [
    (re.compile(r'\b(color)\s*:\s*(#[0-9A-Fa-f]{3,6})\b'), TEXT),
    (re.compile(r'\b(background|background-color)\s*:\s*(#[0-9A-Fa-f]{3,6})\b'), BG),
    (re.compile(r'\b(border|border-top|border-bottom|border-left|border-right|border-color|outline)\s*:\s*([^;}"\']*?)(#[0-9A-Fa-f]{3,6})\b'), LINE),
]

SKIP_SCOPE = re.compile(r'\[data-theme\s*=\s*.dark.\]|\[data-skin\s*=', re.I)
TOKEN_DEF = re.compile(r'--[\w-]+\s*:')

hits = collections.Counter()


def fix_chunk(text):
    """Apply the maps to one chunk that is known not to be dark-scoped."""
    out = text
    for rx, table in BY_PROP:
        def sub(m):
            groups = m.groups()
            prop, lit = groups[0], groups[-1]
            tok = table.get(lit.lower())
            if not tok:
                return m.group(0)
            hits[(prop, lit.lower(), tok)] += 1
            return m.group(0)[: m.start(len(groups)) - m.start(0)] + tok
        out = rx.sub(sub, out)
    return out


def split_rules(css):
    """Yield (chunk, is_rule_body) so a dark-scoped rule can be skipped whole."""
    i, n = 0, len(css)
    while i < n:
        brace = css.find('{', i)
        if brace < 0:
            yield css[i:], False
            return
        close = css.find('}', brace)
        if close < 0:
            yield css[i:], False
            return
        yield css[i:brace + 1], False          # selector + '{'
        yield css[brace + 1:close], True       # body
        i = close


def process_css(css):
    parts, sel = [], ''
    for chunk, is_body in split_rules(css):
        if not is_body:
            sel = chunk
            parts.append(chunk)
            continue
        if SKIP_SCOPE.search(sel) or TOKEN_DEF.search(chunk):
            parts.append(chunk)
        else:
            parts.append(fix_chunk(chunk))
    return ''.join(parts)


def process_html(src):
    # <style> blocks as CSS, style="..." attributes as bare declarations.
    def style_block(m):
        return m.group(1) + process_css(m.group(2)) + m.group(3)
    src = re.sub(r'(<style[^>]*>)(.*?)(</style>)', style_block, src, flags=re.S | re.I)

    def attr(m):
        return m.group(1) + fix_chunk(m.group(2)) + m.group(3)
    src = re.sub(r'(\sstyle=")([^"]*)(")', attr, src)
    return src


def process_js(src):
    # CSS lives in quoted strings. Skip any string that is itself dark-scoped.
    def one(m):
        q, body = m.group(1), m.group(2)
        if SKIP_SCOPE.search(body) or TOKEN_DEF.search(body):
            return m.group(0)
        if not re.search(r'[{;]\s*(color|background|border|outline)\s*:', body):
            return m.group(0)
        return q + fix_chunk(body) + q
    return re.sub(r"(['\"])((?:[^'\"\\\n]|\\.){10,})\1", one, src)


def main():
    check = '--check' in sys.argv
    changed = []
    for f in sorted(glob.glob('app/clinic/**/*.*', recursive=True)):
        if not f.endswith(('.html', '.css', '.js')) or '/vendor/' in f:
            continue
        # The service worker carries a self-contained offline page that never
        # loads clinic.css, so a token there would resolve to nothing.
        if f.endswith('clinic-sw.js'):
            continue
        src = open(f, encoding='utf8').read()
        if f.endswith('.css'):
            out = process_css(src)
        elif f.endswith('.html'):
            out = process_html(src)
        else:
            out = process_js(src)
        if out != src:
            changed.append(f)
            if not check:
                open(f, 'w', encoding='utf8').write(out)
    print(f'{"property":18} {"literal":12} -> {"token":28} {"n":>5}')
    for (prop, lit, tok), n in hits.most_common():
        print(f'{prop:18} {lit:12} -> {tok:28} {n:>5}')
    print(f'\n{sum(hits.values())} replacements in {len(changed)} files'
          f'{" (dry run)" if check else ""}')
    for f in changed:
        print('   ' + f)


if __name__ == '__main__':
    main()
