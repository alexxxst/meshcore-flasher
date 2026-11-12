#!/usr/bin/env python3
"""Generate config.json for the MeshCore SPb flasher from firmware-manifest.json.

Two modes:

  python3 tools/build_config.py            # config.json из манифеста (резервный путь)
  python3 tools/build_config.py --tables   # таблицы tools/catalog.* для build-config.sh

Основной генератор — tools/build-config.sh: он собирает config.json из
папки с реальными ZIP-архивами и таблиц tools/catalog.*. Этот скрипт
остаётся резервным путём: он умеет и то, и другое, чтобы таблицы можно
было пересобрать из манифеста без расхождений.
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
MANIFEST_PATH = TOOLS / "firmware-manifest.json"
CONFIG_PATH = ROOT / "config.json"
DEVICES_TSV = TOOLS / "catalog.devices.tsv"
VERSIONS_TSV = TOOLS / "catalog.versions.tsv"
FILESETS_TSV = TOOLS / "catalog.filesets.tsv"
COMMON_JSON = TOOLS / "catalog.common.json"

BRIDGE_PREFIXES = ("Мост ESPNow. ", "Мост ESPNow, ")


def build_config(manifest):
    roles = manifest["role"]
    file_sets = manifest["fileSet"]

    devices = []
    for source in manifest["devices"]:
        firmware = []
        for entry in source["firmware"]:
            if entry["role"] not in roles:
                raise ValueError(f"{source['name']}: unknown role {entry['role']}")

            versions = {}
            for version_name, version in entry["versions"].items():
                file_set_name = version.get("fileSet", entry.get("fileSet"))
                file_set = file_sets.get(file_set_name)
                if file_set is None:
                    raise ValueError(
                        f"{source['name']}: unknown fileSet {file_set_name} for {version_name}"
                    )
                archive = version["archive"]
                if not archive.endswith(".zip"):
                    raise ValueError(f"{source['name']}: archive must be a zip file")

                versions[version_name] = {
                    "archive": archive,
                    "notes": version.get("notes", ""),
                    "files": file_set["files"],
                }

            firmware_entry = {
                "class": entry.get("class", "spb"),
                "role": entry["role"],
                "version": versions,
            }
            for key in ("title", "subTitle", "tooltip", "notice"):
                if key in entry:
                    firmware_entry[key] = entry[key]
            firmware.append(firmware_entry)

        devices.append(
            {
                "name": source["name"],
                "maker": source["maker"],
                "type": source["type"],
                "dfu": source.get("dfu", "auto"),
                "icon": source["icon"],
                "tooltip": source["tooltip"],
                "firmware": firmware,
            }
        )

    return {
        "firmwareBase": manifest["firmwareBase"],
        "role": roles,
        "firmwareClass": manifest["firmwareClass"],
        "notice": manifest["notice"],
        "device": devices,
    }


# --- таблицы для tools/build-config.sh ---------------------------------


def archive_token(archive):
    """heltec_v4_repeater_bridge_espnow_mqtt-v1.16_cad.zip -> heltec_v4."""
    stem = archive[: -len(".zip")]
    stem = re.sub(r"-v\d.*$", "", stem)
    for suffix in ("_bridge_espnow_mqtt", "_bridge_espnow", "_mqtt", "_repeater"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem


def archive_suffix(archive):
    """heltec_v4_repeater-v1.18-bl-ps-ts.zip -> v1.18-bl-ps-ts."""
    return re.sub(r"^.*?-v", "v", archive[: -len(".zip")])


def split_notes(notes):
    """('Blacklist ...', '1.18') из «… Собрано из MeshCore 1.18.»."""
    text = notes.strip()
    for prefix in BRIDGE_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    match = re.search(r"\.\s*Собрано из MeshCore (.+)\.$", text)
    if not match:
        raise ValueError(f"cannot parse notes: {notes!r}")
    return text[: match.start()], match.group(1)


def catalog_devices(manifest):
    rows = []
    seen = {}
    for device in manifest["devices"]:
        for firmware in device["firmware"]:
            cls = firmware.get("class", "spb")
            band_match = re.match(r"^(mtl\d)-(\d{3})(-bridge)?$", cls)
            prefix = band_match.group(1) if band_match else "-"
            band = band_match.group(2) if band_match else "-"
            for version in firmware["versions"].values():
                token = archive_token(version["archive"])
                key = (token, device["name"])
                if key in seen:
                    if seen[key] != (prefix, band):
                        raise ValueError(f"{token}: conflicting class/band")
                    continue
                seen[key] = (prefix, band)
                rows.append(
                    (
                        token,
                        device["name"],
                        device["maker"],
                        device["type"],
                        device.get("dfu", "auto"),
                        prefix,
                        band,
                        device["icon"],
                        device["tooltip"],
                    )
                )

    head = [
        "# Платы для прошивальщика MeshCore СПб.",
        "# Колонки (через табуляцию):",
        '#   token         — часть имени ZIP до "-vX.Y…" (heltec_v4, mtl_1_sx1268)',
        "#   name          — название платы; строки с одинаковым name склеиваются в одно устройство",
        "#   maker         — производитель",
        "#   type          — esp32 или nrf52 (определяет способ прошивки)",
        '#   dfu           — auto или manual (manual = вход в DFU двойным RST)',
        '#   class_prefix  — префикс класса прошивок: mtl1, mtl2; иначе "-"',
        '#   band          — диапазон: 868, 433; иначе "-"',
        "#   icon          — иконка устройства",
        "#   tooltip       — HTML подсказки при наведении",
        "# Порядок строк = порядок устройств в config.json.",
    ]
    return "\n".join(head + ["\t".join(row) for row in rows]) + "\n"


def catalog_versions(manifest):
    order = []
    variants = {}
    for device in manifest["devices"]:
        for firmware in device["firmware"]:
            kind = "observer" if "observer" in firmware["role"].lower() else "repeater"
            for label, version in firmware["versions"].items():
                suffix = archive_suffix(version["archive"])
                features, source = split_notes(version.get("notes", ""))
                record = (label, kind, features, source)
                if suffix in variants and variants[suffix] != record:
                    raise ValueError(
                        f"{suffix}: conflicting metadata\n"
                        f"  {variants[suffix]}\n  {record}"
                    )
                if suffix not in variants:
                    variants[suffix] = record
                    order.append(suffix)

    head = [
        "# Варианты версий прошивок.",
        "# Колонки (через табуляцию):",
        '#   suffix   — хвост имени ZIP после "-" (v1.18-bl-ps-ts, v1.16_cad)',
        "#   label    — подпись в селекторе версий",
        "#   kind     — repeater или observer",
        '#   features — что внутри; идёт в "notes" перед "Собрано из MeshCore …"',
        '#   source   — версия MeshCore для хвоста "Собрано из MeshCore <source>."',
        "# Порядок строк = порядок версий в селекторе.",
    ]
    rows = ["\t".join((suffix, *variants[suffix])) for suffix in order]
    return "\n".join(head + rows) + "\n"


def catalog_filesets(manifest):
    head = [
        "# Наборы файлов внутри ZIP: какие записи архива и как прошивать.",
        "# Колонки (через табуляцию):",
        "#   fileset — esp32 или nrf52",
        "#   type    — flash-wipe, flash-update, flash, download",
        "#   match   — regex по имени файла внутри архива",
        "#   title   — подпись в интерфейсе",
        "# Порядок строк внутри одного fileset сохраняется в config.json.",
    ]
    rows = []
    for name, data in manifest["fileSet"].items():
        for item in data["files"]:
            rows.append("\t".join((name, item["type"], item["match"], item["title"])))
    return "\n".join(head + rows) + "\n"


def catalog_common(manifest):
    """Блоки role/firmwareClass/notice ровно в том виде, как в config.json."""
    common = {
        "role": manifest["role"],
        "firmwareClass": manifest["firmwareClass"],
        "notice": manifest["notice"],
    }
    body = json.dumps(common, ensure_ascii=False, indent=2).split("\n")[1:-1]
    body[-1] += ","
    return "\n".join(body) + "\n"


def write_tables(manifest):
    DEVICES_TSV.write_text(catalog_devices(manifest), encoding="utf-8")
    VERSIONS_TSV.write_text(catalog_versions(manifest), encoding="utf-8")
    FILESETS_TSV.write_text(catalog_filesets(manifest), encoding="utf-8")
    COMMON_JSON.write_text(catalog_common(manifest), encoding="utf-8")
    for path in (DEVICES_TSV, VERSIONS_TSV, FILESETS_TSV, COMMON_JSON):
        print(f"wrote {path}")


def write_config(manifest):
    config = build_config(manifest)
    CONFIG_PATH.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {CONFIG_PATH}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tables",
        action="store_true",
        help="пересобрать tools/catalog.* из манифеста",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if args.tables:
        write_tables(manifest)
    else:
        write_config(manifest)


if __name__ == "__main__":
    main()
