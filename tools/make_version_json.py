#!/usr/bin/env python3
"""Write app/clinic/version.json — what an installed app compares itself against.

The Android app has the whole web app baked into the APK file, so nothing in it
can ever change on its own: `self.registration.update()` re-fetches the worker
from its OWN origin, which inside the APK is the installed file. It always
finds itself, and the clinic sees no updates until somebody downloads a new
APK.

This file is the other half of the answer. It lists the version and every file
that makes up a build, so a phone can ask "is there a newer one?" and fetch
exactly what changed — into the SAME origin it already runs on, so the clinic's
offline data, queued consultations and settings are untouched.

Generated from clinic-sw.js itself rather than kept by hand, because a
version.json that disagrees with the worker is worse than none: it would tell
a phone to download files that are not there.

    python3 tools/make_version_json.py
"""
import json, os, re, sys

SW = 'app/clinic/clinic-sw.js'
OUT = 'app/clinic/version.json'


def main():
    src = open(SW, encoding='utf8').read()

    cache = re.search(r"const CACHE\s*=\s*'([^']+)'", src)
    data_v = re.search(r"const DATA_VERSION\s*=\s*'([^']+)'", src)
    shell = re.search(r'const SHELL\s*=\s*\[(.*?)\];', src, re.S)
    vendor = re.search(r'const VENDOR\s*=\s*\[(.*?)\];', src, re.S)
    if not (cache and data_v and shell):
        print('could not read CACHE / DATA_VERSION / SHELL from', SW)
        return 1

    # COMMENTS FIRST, and this is not tidiness.
    #
    # This used to scan the whole SHELL block for quoted strings. SHELL is
    # heavily commented — it is where "why is this file here" is written — and
    # one comment containing an apostrophe ("the phone's own bars") was read as
    # the start of a string. The generator happily listed
    #
    #     "s own status and navigation bars. In SHELL because a page that"
    #
    # as a file of the build. Nothing complained. version.json was written,
    # deployed, and every installed app that fetched it staged the new build,
    # failed on that one entry, deleted the staging cache and reported "the
    # connection dropped part-way" — for ever, on every phone, six-hourly,
    # while the connection was perfectly fine.
    #
    # An apostrophe in a comment silently disabling updates for a whole country
    # is a good argument for not parsing JavaScript with a regex, and a better
    # one for the existence check below.
    block = re.sub(r'/\*.*?\*/', '', shell.group(1), flags=re.S)
    block = re.sub(r'//[^\n]*', '', block)
    files = [f for f in re.findall(r"'([^']+)'", block)]
    # Cross-origin libraries are fetched from their own CDN by the worker
    # already and are versioned/stable, so they are not part of a build.
    vendor_urls = set(re.findall(r"'([^']+)'", vendor.group(1))) if vendor else set()
    files = [f for f in files if f not in vendor_urls and not f.startswith('http')]

    # The bundled books. Cache-first and never re-downloaded, so they are only
    # worth sending when the book itself has been rebuilt — they are 4 MB and
    # this is a phone on Ugandan mobile data.
    data = []
    ddir = 'app/clinic/data'
    if os.path.isdir(ddir):
        for name in sorted(os.listdir(ddir)):
            if name.endswith('.db'):
                data.append('data/%s?v=%s' % (name, data_v.group(1)))

    # EVERY LISTED FILE MUST EXIST. This is the guard, and it is worth more
    # than the comment-stripping above — that fixes one way of producing a
    # bad list, this catches all of them.
    #
    # An installed app fetches every entry here and, on the FIRST failure,
    # throws the whole staged build away. One wrong line does not degrade the
    # update; it stops it completely, on every phone, and reports it as a bad
    # connection. A build that cannot be delivered is worse than no build, and
    # this is the last place it can be noticed before it is a clinic's problem.
    #
    # Fail loudly and name them. A generator that writes a broken manifest and
    # exits 0 has done the most damaging thing available to it.
    missing = []
    for rel in files:
        clean = rel.split('?')[0]
        if clean in ('./', ''):
            clean = 'index.html'
        p = os.path.normpath(os.path.join('app', 'clinic', clean))
        if not os.path.isfile(p):
            missing.append('%s  ->  %s' % (rel, p))
    if missing:
        print('REFUSING to write %s — %d file(s) in SHELL do not exist:' % (OUT, len(missing)))
        for m in missing:
            print('   ' + m)
        print('An installed app throws away the whole update on the first one '
              'of these and reports it as a bad connection, so nothing would '
              'ever update again and nothing would say why.')
        return 1

    out = {
        'cache': cache.group(1),
        'dataVersion': data_v.group(1),
        'files': files,
        'data': data,
    }
    with open(OUT, 'w', encoding='utf8') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print('%s → %s, %d files, %d books (data v%s)'
          % (OUT, out['cache'], len(files), len(data), out['dataVersion']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
