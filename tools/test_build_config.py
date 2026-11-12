import json
import re
import unittest
from pathlib import Path

from build_config import build_config

ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "firmware-manifest.json"


class BuildConfigTest(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.config = build_config(self.manifest)

    def test_catalog_has_expected_device_firmware_and_version_counts(self):
        self.assertEqual(len(self.config["device"]), 10)
        self.assertEqual(
            sum(len(device["firmware"]) for device in self.config["device"]),
            22,
        )
        self.assertEqual(
            sum(
                len(firmware["version"])
                for device in self.config["device"]
                for firmware in device["firmware"]
            ),
            77,
        )

    def test_device_names_are_unique(self):
        names = [device["name"] for device in self.config["device"]]
        self.assertEqual(len(names), len(set(names)))

    def test_firmware_versions_are_wrapped_with_archive_and_notes(self):
        firmware = self.config["device"][0]["firmware"][0]
        self.assertIn("v1.18 · BL+PS+TS", firmware["version"])
        version = firmware["version"]["v1.18 · BL+PS+TS"]
        self.assertTrue(version["archive"].endswith(".zip"))
        self.assertTrue(version["notes"])
        self.assertTrue(version["files"])

    def test_heltec_v3_repeater_has_all_variants(self):
        device = next(d for d in self.config["device"] if d["name"] == "Heltec v3")
        repeater = next(f for f in device["firmware"] if f["role"] == "repeater")
        self.assertEqual(
            list(repeater["version"]),
            [
                "v1.18 · BL+PS+TS",
                "v1.18 · BL+PS",
                "v1.18 · PR2343",
                "v1.17.1 · PR2343",
                "v1.16 · PR2343",
            ],
        )

    def test_observer_has_cad_version(self):
        device = next(d for d in self.config["device"] if d["name"] == "Heltec v3")
        observer = next(f for f in device["firmware"] if f["role"] == "observer")
        self.assertIn("v1.16 · CAD", observer["version"])

    def test_short_version_sets_are_preserved(self):
        by_name = {d["name"]: d for d in self.config["device"]}
        tbeam = next(f for f in by_name["LilyGo T-Beam SX1262"]["firmware"] if f["role"] == "repeater")
        self.assertNotIn("v1.16 · PR2343", tbeam["version"])
        promicro = next(f for f in by_name["ProMicro nRF52 (fakeTec)"]["firmware"] if f["role"] == "repeater")
        self.assertEqual(list(promicro["version"]), ["v1.18 · BL+PS+TS"])

    def test_file_set_patterns_match_old_and_new_esp32_update_names(self):
        firmware = self.config["device"][0]["firmware"][0]
        files = firmware["version"]["v1.18 · BL+PS+TS"]["files"]
        wipe = next(f for f in files if f["type"] == "flash-wipe")
        update = next(f for f in files if f["type"] == "flash-update")

        self.assertIsNotNone(re.search(wipe["match"], "Heltec_v3-...-merged.bin"))
        self.assertIsNotNone(re.search(update["match"], "Heltec_v3-...-upgrade.bin"))
        self.assertIsNotNone(re.search(update["match"], "Heltec_v3-...-96b324bc.bin"))
        self.assertIsNone(re.search(update["match"], "Heltec_v3-...-merged.bin"))

    def test_companion_roles_are_reserved_for_future_firmware(self):
        self.assertIn("companionBle", self.config["role"])
        self.assertIn("companionUsb", self.config["role"])

    def test_mtl_frequency_blocks(self):
        by_name = {device["name"]: device for device in self.config["device"]}
        self.assertNotIn("MTL-1 868 МГц (SX1262)", by_name)
        self.assertNotIn("MTL-1 433 МГц (SX1268)", by_name)
        self.assertIn("MTL-1", by_name)
        self.assertIn("MTL-2", by_name)
        mtl1_classes = [f["class"] for f in by_name["MTL-1"]["firmware"]]
        self.assertEqual(
            mtl1_classes,
            ["mtl1-868", "mtl1-868", "mtl1-433", "mtl1-433",
             "mtl1-868-bridge", "mtl1-868-bridge", "mtl1-433-bridge", "mtl1-433-bridge"],
        )
        mtl2_classes = [f["class"] for f in by_name["MTL-2"]["firmware"]]
        self.assertEqual(mtl2_classes, ["mtl2-868", "mtl2-433"])

    def test_bridge_is_a_class_inside_base_devices(self):
        by_name = {device["name"]: device for device in self.config["device"]}
        self.assertNotIn("Heltec v4 ESPNow Bridge", by_name)
        heltec = by_name["Heltec v4"]
        self.assertEqual(len(heltec["firmware"]), 4)
        bridge_roles = [f["role"] for f in heltec["firmware"] if f["class"] == "bridge"]
        self.assertEqual(bridge_roles, ["bridgeRepeater", "bridgeObserver"])
        self.assertEqual(self.config["firmwareClass"]["bridge"]["title"], "Мосты ESPNow")

    def test_firmware_class_is_renamed_to_recommended(self):
        self.assertEqual(
            self.config["firmwareClass"]["spb"]["title"],
            "Рекомендуемые прошивки",
        )

    def test_every_device_has_valid_type_and_firmware_roles(self):
        valid_types = {"esp32", "nrf52"}
        roles = set(self.config["role"])
        for device in self.config["device"]:
            self.assertIn(device["type"], valid_types, device["name"])
            for firmware in device["firmware"]:
                self.assertIn(firmware["role"], roles, device["name"])

    def test_every_version_has_an_archive(self):
        for device in self.config["device"]:
            for firmware in device["firmware"]:
                self.assertTrue(firmware["version"], device["name"])
                for version_name, version in firmware["version"].items():
                    self.assertTrue(
                        version["archive"].endswith(".zip"),
                        f"{device['name']} {version_name}",
                    )

    def test_firmware_base_is_relative_for_subdirectory_hosting(self):
        self.assertFalse(self.config["firmwareBase"].startswith("/"))
        self.assertFalse(self.config["firmwareBase"].startswith("http"))

    def test_manual_dfu_boards_are_marked(self):
        by_name = {device["name"]: device for device in self.config["device"]}
        self.assertEqual(by_name["Heltec Mesh Node T096"]["dfu"], "manual")
        self.assertEqual(by_name["Heltec Mesh Node T114"]["dfu"], "manual")
        self.assertEqual(by_name["Heltec v3"]["dfu"], "auto")


if __name__ == "__main__":
    unittest.main()
