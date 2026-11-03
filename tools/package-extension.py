"""Reproducible Firefox XPI. No source processing, network or third-party build tools."""
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def runtime_files():
    files = [ROOT / name for name in ['manifest.json', 'background.js', 'i18n.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md']]
    for name in ['lib', 'content', 'popup', 'icons', 'options', '_locales', 'licenses']:
        files.extend(p for p in (ROOT / name).rglob('*') if p.is_file())
    # Upstream original retained in source for provenance; only the sandbox bridge is loaded.
    return sorted(p for p in files if p.name != '.DS_Store' and p != ROOT / 'lib/html-to-image.js')

def build(output):
    output = Path(output); output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in runtime_files():
            entry = zipfile.ZipInfo(file.relative_to(ROOT).as_posix(), (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, file.read_bytes())
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='dist/pagesaver.xpi')
    print(build(parser.parse_args().output))
