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

    files = [f for f in re.findall(r"'([^']+)'", shell.group(1))]
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
