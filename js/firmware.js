// Pure firmware-selection helpers. No browser APIs, so they can be tested in Node.

export function pickArchiveEntry(entries, match) {
  const pattern = match instanceof RegExp ? match : new RegExp(match);
  const found = entries.find((name) => pattern.test(name));

  if (!found) {
    throw new Error(`В архиве не найден файл по шаблону ${pattern}`);
  }

  return found;
}

export function pickFirmwareFile(files, { esp32, wipe = false }) {
  if (esp32) {
    const preferred = files.find((file) => file.type === (wipe ? 'flash-wipe' : 'flash-update'));
    if (preferred) return preferred;
  }

  return files.find((file) => file.type.startsWith('flash')) ?? null;
}

export function requiresObserverConfirmation(role) {
  return String(role).toLowerCase().endsWith('observer');
}

export function isMergedFilename(name) {
  return /-merged\.bin$/i.test(name);
}

// ESP32 app partition; merged images (bootloader + partitions + app) start at 0
export const ESP32_APP_ADDRESS = 0x10000;

export function esp32Address(file) {
  return file.type === 'flash-wipe' || isMergedFilename(file.title ?? file.name ?? '')
    ? 0
    : ESP32_APP_ADDRESS;
}

export function resolveArchiveUrl(base, archive) {
  return new URL(archive, base).href;
}

// Band of a firmware entry: from the class suffix (mtl1-868, s3zero-433,
// mtl1-433-bridge) or from the role (mtl1_433_repeater). No class/band
// means the default 868 MHz.
export function bandOf(firmware) {
  const cls = String(firmware?.class ?? '');
  const fromClass = /-(\d{3})(?:-bridge)?$/.exec(cls);
  if (fromClass) return fromClass[1];

  const role = String(firmware?.role ?? '');
  const fromRole = /_(\d{3})_/.exec(role);
  if (fromRole) return fromRole[1];

  return '868';
}

// Screen variant of a firmware entry: sh1106/ssd1306. Empty when the board
// has no screen variants (only the MTL-2 builds currently do).
export function screenOf(firmware) {
  const text = `${firmware?.class ?? ''} ${firmware?.role ?? ''}`;
  const match = /(sh1106|ssd1306)/i.exec(text);
  return match ? match[1].toUpperCase() : '';
}
