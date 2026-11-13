// Device/firmware catalog loaded from the static config.json.

import { fetchJson, escapeHtml } from './util.js?v=1a459fe26f';

export const hasVersions = (firmware) => Object.values(firmware.version ?? {}).some((v) => v.files.length > 0);

export async function loadCatalog() {
  // no-store: после обновления каталога браузер не должен показывать старые версии
  const config = await fetchJson(new URL('../config.json', import.meta.url), { cache: 'no-store' });

  config.device = config.device.filter((device) => device.firmware.some(hasVersions));

  return config;
}

// Firmware title/icon/tooltip fall back to its role's defaults
export const roleValue = (config, firmware, key) => firmware[key] ?? config.role[firmware.role]?.[key] ?? '';

// Notices may reference device fields, e.g. ${bootloader} (arrays use their first item)
export function renderNotice(config, device, firmware) {
  const notice = config.notice?.[firmware.notice] || firmware.notice || '';

  return notice.replaceAll(/\$\{(\w+)\}/g, (_, field) => {
    const value = device[field];
    return (Array.isArray(value) ? value[0] : value) || '';
  });
}

// Release notes are plain text in the SPb config; keep the GitHub PR linkification.
export function formatNotes(notes) {
  return escapeHtml(notes)
    .replaceAll(/#(\d+)/g, '<a target="_blank" rel="noopener" href="https://github.com/meshcore-dev/MeshCore/pull/$1">#$1</a>')
    .replaceAll(/\r?\n/g, '<br>');
}
