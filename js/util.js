export function delay(millis) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

export function toSlug(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${url}: HTTP ${res.status}`);

  return await res.json();
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// esptool.js expects firmware as a "binary string" (one char per byte)
export async function blobToBinaryString(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binString = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binString += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return binString;
}
