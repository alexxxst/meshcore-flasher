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
