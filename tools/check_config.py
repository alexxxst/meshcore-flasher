#!/usr/bin/env python3
"""Validate config.json archives and the files inside them."""

import argparse
import io
import json
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
SITE_BASE = "https://meshcore.spb.ru/flasher/"


def resolve_archive_url(firmware_base: str, archive: str) -> str:
    return urljoin(urljoin(SITE_BASE, firmware_base), archive)


def check_archive(url: str, files: list[dict]) -> list[str]:
    errors = []
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        return [f"HTTP {exc.code}"]
    except Exception as exc:  # noqa: BLE001 - report the real reason
        return [f"download failed: {exc}"]

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = [
                entry
                for entry in archive.namelist()
                if not entry.startswith("__MACOSX/")
                and not entry.rsplit("/", 1)[-1].startswith("._")
            ]
    except zipfile.BadZipFile:
        return ["not a valid zip archive"]

    for file in files:
        pattern = re.compile(file["match"])
        matches = [entry for entry in entries if pattern.search(entry)]
        if not matches:
            errors.append(f"no entry matches {file['match']!r}")
        elif len(matches) > 1:
            errors.append(f"{len(matches)} entries match {file['match']!r}: {matches}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--head",
        action="store_true",
        help="only check that archives are reachable, do not download them",
    )
    args = parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    firmware_base = config["firmwareBase"]

    checked = {}
    failures = 0

    for device in config["device"]:
        for firmware in device["firmware"]:
            for version_name, version in firmware["version"].items():
                archive = version["archive"]
                url = resolve_archive_url(firmware_base, archive)
                if url in checked:
                    errors = checked[url]
                else:
                    if args.head:
                        try:
                            request = urllib.request.Request(url, method="HEAD")
                            with urllib.request.urlopen(request, timeout=30) as response:
                                errors = [] if response.status == 200 else [f"HTTP {response.status}"]
                        except Exception as exc:  # noqa: BLE001
                            errors = [f"HEAD failed: {exc}"]
                    else:
                        errors = check_archive(url, version["files"])
                    checked[url] = errors

                if errors:
                    failures += 1
                    print(f"FAIL {device['name']:38} {version_name:20} {archive}")
                    for error in errors:
                        print(f"     {error}")
                else:
                    print(f"OK   {device['name']:38} {version_name:20} {archive}")

    print()
    print(f"archives: {len(checked)}, failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
