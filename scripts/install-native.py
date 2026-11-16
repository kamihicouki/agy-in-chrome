"""Register the local ACP bridge for an explicitly chosen Chrome extension ID."""
import argparse
import json
import os
import re
import shlex
import shutil
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("extension_id")
parser.add_argument("--workspace", type=Path, help="Existing task directory. Default: ~/.agy-in-chrome/workspace.")
parser.add_argument("--chrome-for-testing", action="store_true")
parser.add_argument("--user-data-dir", type=Path, help="Chrome user data directory when using a custom profile.")
args = parser.parse_args()

if sys.platform not in ("darwin", "linux") or not re.fullmatch(r"[a-p]{32}", args.extension_id):
    parser.error("Use macOS or Linux and a valid Chrome extension ID.")
node, agy = shutil.which("node"), shutil.which("agy")
workspace = (args.workspace or Path.home() / ".agy-in-chrome/workspace").expanduser().resolve()
if args.workspace is None:
    workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
if not node or not agy or not workspace.is_dir() or workspace in (Path.home().resolve(), Path("/")):
    parser.error("Install Node.js and Antigravity CLI, and select an existing workspace.")
host = Path(__file__).resolve().parents[1] / "native/host.mjs"
if not host.is_file():
    parser.error("Run the installer from the source repository.")
name = "com.agy_in_chrome.acp"
browser = "Chrome for Testing" if args.chrome_for_testing else "Chrome"
if args.user_data_dir:
    directory = args.user_data_dir.expanduser().resolve() / "NativeMessagingHosts"
elif sys.platform == "darwin":
    folder = "ChromeForTesting" if args.chrome_for_testing else "Chrome"
    directory = Path.home() / "Library/Application Support/Google" / folder / "NativeMessagingHosts"
else:
    folder = "google-chrome-for-testing" if args.chrome_for_testing else "google-chrome"
    directory = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / folder / "NativeMessagingHosts"
directory.mkdir(parents=True, exist_ok=True)
launcher = directory / f"{name}.sh"
launcher.write_text("#!/bin/sh\nexec " + shlex.join([str(Path(node).absolute()), str(host), str(Path(agy).absolute()), str(workspace)]) + "\n")
launcher.chmod(0o700)
(directory / f"{name}.json").write_text(json.dumps({
    "name": name,
    "description": "agy in chrome local ACP bridge",
    "path": str(launcher),
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{args.extension_id}/"],
}, indent=2) + "\n")
print(f"Registered {name} for {browser}. Workspace: {workspace}")
