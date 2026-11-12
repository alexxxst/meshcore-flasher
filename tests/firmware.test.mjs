import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickArchiveEntry,
  pickFirmwareFile,
  requiresObserverConfirmation,
  isMergedFilename,
  resolveArchiveUrl,
  esp32Address,
} from '../js/firmware.js';

test('pickArchiveEntry returns the entry matching the pattern', () => {
  const entries = ['Heltec_v3-freshInstall-merged.bin', 'Heltec_v3-upgrade.bin'];
  assert.equal(pickArchiveEntry(entries, '-merged\\.bin$'), 'Heltec_v3-freshInstall-merged.bin');
  assert.equal(pickArchiveEntry(entries, '-upgrade\\.bin$'), 'Heltec_v3-upgrade.bin');
});

test('pickArchiveEntry throws a clear error when nothing matches', () => {
  assert.throws(
    () => pickArchiveEntry(['Heltec_v3-upgrade.bin'], '-merged\\.bin$'),
    /не найден файл по шаблону/,
  );
});

test('pickFirmwareFile prefers flash-wipe for an ESP32 erase', () => {
  const files = [{ type: 'flash-wipe' }, { type: 'flash-update' }];
  assert.equal(pickFirmwareFile(files, { esp32: true, wipe: true }).type, 'flash-wipe');
});

test('pickFirmwareFile prefers flash-update for an ESP32 update', () => {
  const files = [{ type: 'flash-wipe' }, { type: 'flash-update' }];
  assert.equal(pickFirmwareFile(files, { esp32: true, wipe: false }).type, 'flash-update');
});

test('pickFirmwareFile falls back to any flash file when the preferred type is missing', () => {
  const files = [{ type: 'flash-wipe' }];
  assert.equal(pickFirmwareFile(files, { esp32: true, wipe: false }).type, 'flash-wipe');
});

test('pickFirmwareFile picks the nRF52 OTA zip and ignores download-only files', () => {
  const files = [{ type: 'download' }, { type: 'flash' }];
  assert.equal(pickFirmwareFile(files, { esp32: false }).type, 'flash');
});

test('pickFirmwareFile returns null when there is nothing to flash', () => {
  assert.equal(pickFirmwareFile([{ type: 'download' }], { esp32: false }), null);
});

test('observer firmware requires an explicit confirmation', () => {
  assert.equal(requiresObserverConfirmation('observer'), true);
  assert.equal(requiresObserverConfirmation('bridgeObserver'), true);
  assert.equal(requiresObserverConfirmation('mtl1_868_observer'), true);
  assert.equal(requiresObserverConfirmation('mtl1_433_bridge_observer'), true);
  assert.equal(requiresObserverConfirmation('bridgeRepeater'), false);
  assert.equal(requiresObserverConfirmation('mtl1_868_repeater'), false);
  assert.equal(requiresObserverConfirmation('repeater'), false);
  assert.equal(requiresObserverConfirmation('companionBle'), false);
});

test('isMergedFilename detects merged ESP32 images only', () => {
  assert.equal(isMergedFilename('Heltec_v3-freshInstall-merged.bin'), true);
  assert.equal(isMergedFilename('Heltec_v3-upgrade.bin'), false);
  assert.equal(isMergedFilename('firmware.zip'), false);
});

test('esp32Address writes merged images at 0', () => {
  assert.equal(esp32Address({ type: 'flash-wipe', title: 'merged — с очисткой данных' }), 0);
  assert.equal(esp32Address({ type: 'flash', name: 'custom-merged.bin' }), 0);
});

test('esp32Address writes app-only updates at 0x10000', () => {
  assert.equal(esp32Address({ type: 'flash-update', title: 'upgrade — обновление' }), 0x10000);
  assert.equal(esp32Address({ type: 'flash', name: 'custom.bin' }), 0x10000);
});

test('resolveArchiveUrl resolves relative archives against the firmware base', () => {
  assert.equal(
    resolveArchiveUrl('https://meshcore.spb.ru/wiki/files/', 'heltec_v3.zip'),
    'https://meshcore.spb.ru/wiki/files/heltec_v3.zip',
  );
  assert.equal(
    resolveArchiveUrl('https://meshcore.spb.ru/wiki/files/', 'https://cdn.example/fw.zip'),
    'https://cdn.example/fw.zip',
  );
});
