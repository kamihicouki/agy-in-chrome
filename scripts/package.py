import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text())
version = manifest["version"]
parts = version.split(".")
if (
    len(parts) != 3
    or any(not re.fullmatch(r"0|[1-9][0-9]{0,4}", part) for part in parts)
    or any(int(part) > 65535 for part in parts)
    or all(part == "0" for part in parts)
):
    raise SystemExit("manifest.json must have a valid three-part Chrome version")

files = ["manifest.json", "background.mjs", "panel.html", "panel.css", "panel.js", "context.mjs"]
files += [f"icons/{size}.png" for size in (16, 32, 48, 128)]
dist = ROOT / "dist"
dist.mkdir(exist_ok=True)
archive = dist / f"agy-in-chrome-{version}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for file in files:
        package.write(ROOT / file, file)
print(archive)
