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
        self.assertEqual(len(self.config["device"]), 24)
        self.assertEqual(
            sum(len(device["firmware"]) for device in self.config["device"]),
            50,
        )
        self.assertEqual(
            sum(
                len(firmware["version"])
                for device in self.config["device"]
                for firmware in device["firmware"]
            ),
            50,
        )

    def test_device_names_are_unique(self):
        names = [device["name"] for device in self.config["device"]]
        self.assertEqual(len(names), len(set(names)))

    def test_firmware_versions_are_wrapped_with_archive_and_notes(self):
        device = self.config["device"][0]
        firmware = next(f for f in device["firmware"] if f["role"] == "repeater")
        self.assertIn("v1.18 · BL+PS+TS", firmware["version"])
        version = firmware["version"]["v1.18 · BL+PS+TS"]
        self.assertTrue(version["archive"].endswith(".zip"))
        self.assertTrue(version["notes"])
        self.assertTrue(version["files"])

    def test_heltec_v3_has_current_versions(self):
        device = next(d for d in self.config["device"] if d["name"] == "Heltec v3")
        repeater = next(f for f in device["firmware"] if f["role"] == "repeater")
        observer = next(f for f in device["firmware"] if f["role"] == "observer")
        self.assertEqual(list(repeater["version"]), ["v1.18 · BL+PS+TS"])
        self.assertEqual(list(observer["version"]), ["v1.18"])

    def test_generic_esp32s3_zero_has_two_band_repeaters(self):
        device = next(d for d in self.config["device"] if d["name"] == "Generic ESP32-S3 Zero")
        self.assertEqual([f["class"] for f in device["firmware"]], ["s3zero-868", "s3zero-433"])
        self.assertEqual(
            [f["role"] for f in device["firmware"]],
            ["s3zero_868_repeater", "s3zero_433_repeater"],
        )
        archives = [f["version"]["v1.18 · BL+PS+TS"]["archive"] for f in device["firmware"]]
        self.assertEqual(
            archives,
            [
                "generic_esp32s3_zero_sx1262_repeater-v1.18-bl-ps-ts.zip",
                "generic_esp32s3_zero_sx1268_repeater-v1.18-bl-ps-ts.zip",
            ],
        )

    def test_short_version_sets_are_preserved(self):
        by_name = {d["name"]: d for d in self.config["device"]}
        tbeam = next(f for f in by_name["LilyGo T-Beam SX1262"]["firmware"] if f["role"] == "repeater")
        self.assertNotIn("v1.16 · PR2343", tbeam["version"])
        promicro = next(f for f in by_name["ProMicro nRF52 (fakeTec)"]["firmware"] if f["role"] == "repeater")
        self.assertEqual(list(promicro["version"]), ["v1.18 · BL+PS+TS"])

    def test_file_set_patterns_match_old_and_new_esp32_update_names(self):
        device = self.config["device"][0]
        firmware = next(f for f in device["firmware"] if f["role"] == "repeater")
        files = firmware["version"]["v1.18 · BL+PS+TS"]["files"]
        wipe = next(f for f in files if f["type"] == "flash-wipe")
        update = next(f for f in files if f["type"] == "flash-update")

        self.assertIsNotNone(re.search(wipe["match"], "Heltec_v3-...-merged.bin"))
        self.assertIsNotNone(re.search(update["match"], "Heltec_v3-...-upgrade.bin"))
        self.assertIsNotNone(re.search(update["match"], "Heltec_v3-...-96b324bc.bin"))
        self.assertIsNone(re.search(update["match"], "Heltec_v3-...-merged.bin"))

    def test_companions_are_first_in_every_block(self):
        by_name = {d["name"]: d for d in self.config["device"]}
        heltec = by_name["Heltec v3"]
        self.assertEqual(
            [f["role"] for f in heltec["firmware"]],
            ["companionBle", "repeater", "observer"],
        )
        companion = heltec["firmware"][0]
        self.assertEqual(list(companion["version"]), ["v1.18 · PS"])
        self.assertTrue(companion["version"]["v1.18 · PS"]["archive"].endswith("-v1.18-ps.zip"))

        mtl1 = by_name["MTL-1"]
        self.assertEqual(mtl1["firmware"][0]["role"], "mtl1_868_companion")
        self.assertEqual(mtl1["firmware"][3]["role"], "mtl1_433_companion")
        self.assertIn("mtl1_868_companion", self.config["role"])
        self.assertIn("mtl2_433_companion", self.config["role"])

        tbeam1w = by_name["LilyGo T-Beam 1W"]
        self.assertEqual([f["role"] for f in tbeam1w["firmware"]], ["companionBle", "repeater"])

        # платы только с компаньоном
        echo = by_name["LilyGo T-Echo"]
        self.assertEqual([f["role"] for f in echo["firmware"]], ["companionBle"])
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
            ["mtl1-868", "mtl1-868", "mtl1-868", "mtl1-433", "mtl1-433", "mtl1-433",
             "mtl1-868-bridge", "mtl1-868-bridge", "mtl1-433-bridge", "mtl1-433-bridge"],
        )
        mtl2_classes = [f["class"] for f in by_name["MTL-2"]["firmware"]]
        self.assertEqual(mtl2_classes, ["mtl2-868", "mtl2-868", "mtl2-433", "mtl2-433"])

    def test_bridge_is_a_class_inside_base_devices(self):
        by_name = {device["name"]: device for device in self.config["device"]}
        self.assertNotIn("Heltec v4 ESPNow Bridge", by_name)
        heltec = by_name["Heltec v4"]
        self.assertEqual(len(heltec["firmware"]), 5)
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

    def test_switch_notice_matches_flash_type_and_role(self):
        notice = self.config["notice"]
        for key in ("switchType", "switchTypeNrf52", "switchTypeCompanion", "switchTypeCompanionNrf52"):
            self.assertIn(key, notice)

        # для nRF52 не может быть merged — там стирание отдельной прошивкой
        self.assertNotIn("merged", notice["switchTypeNrf52"].lower())
        self.assertIn("Стереть flash", notice["switchTypeNrf52"])
        self.assertNotIn("merged", notice["switchTypeCompanionNrf52"].lower())
        self.assertIn("Стереть flash", notice["switchTypeCompanionNrf52"])

        # на странице компаньона не говорим про репитеры
        for key in ("switchTypeCompanion", "switchTypeCompanionNrf52"):
            self.assertNotIn("репитер", notice[key].lower())

        self.assertIn("merged", notice["switchType"].lower())
        self.assertIn("репитера", notice["switchType"].lower())

    def test_manual_dfu_boards_are_marked(self):
        by_name = {device["name"]: device for device in self.config["device"]}
        self.assertEqual(by_name["Heltec Mesh Node T096"]["dfu"], "manual")
        self.assertEqual(by_name["Heltec Mesh Node T114"]["dfu"], "manual")
        self.assertEqual(by_name["Heltec v3"]["dfu"], "auto")


if __name__ == "__main__":
    unittest.main()
