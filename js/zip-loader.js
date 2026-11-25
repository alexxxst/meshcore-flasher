// Downloads a firmware archive from the wiki and extracts one entry with zip.js.
import { ZipReader, BlobReader, BlobWriter } from '../lib/zip.min.js?v=1e2493dc3c';
import { pickArchiveEntry } from './firmware.js?v=1e2493dc3c';

const archiveCache = new Map();
const entryCache = new Map();
const decoder = new TextDecoder();

function entryName(entry) {
  return entry.filename ?? decoder.decode(entry.rawFilename);
}

async function fetchArchive(url, onProgress) {
  if (archiveCache.has(url)) {
    onProgress?.(100);
    return archiveCache.get(url);
  }

  let response;
  try {
    // no-store: nginx отдаёт ZIP с max-age на 10 лет, а адрес архива не меняется,
    // поэтому без этого браузер после пересборки прошивки отдаёт старый файл.
    response = await fetch(url, { cache: 'no-store' });
  }
  catch (e) {
    throw new Error(`Не удалось скачать архив прошивки. Проверьте соединение и повторите попытку. (${e.message})`);
  }

  if (response.status === 404) {
    throw new Error('Архив прошивки не найден на сервере (HTTP 404). Похоже, файл ещё не загружен на wiki — сообщите об этом в чат сообщества.');
  }

  if (!response.ok) {
    throw new Error(`Не удалось скачать архив прошивки: HTTP ${response.status}. Попробуйте ещё раз.`);
  }

  const total = Number(response.headers.get('Content-Length')) || 0;
  let blob;

  if (!response.body || !total) {
    blob = await response.blob();
    onProgress?.(100);
  }
  else {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(100, (received / total) * 100));
    }

    blob = new Blob(chunks, { type: 'application/zip' });
  }

  archiveCache.set(url, blob);
  return blob;
}

export async function loadArchiveEntry(url, match, { onProgress } = {}) {
  const key = `${url}\n${match}`;
  if (entryCache.has(key)) {
    onProgress?.(100);
    return entryCache.get(key);
  }

  const archive = await fetchArchive(url, onProgress);
  const reader = new ZipReader(new BlobReader(archive));

  try {
    const entries = (await reader.getEntries()).filter((entry) => {
      const name = entryName(entry);
      return !entry.dir
        && !name.startsWith('__MACOSX/')
        && !name.split('/').pop().startsWith('._');
    });
    const names = entries.map(entryName);
    const name = pickArchiveEntry(names, match);
    const entry = entries.find((item) => entryName(item) === name);
    const blob = await entry.getData(new BlobWriter());
    const result = { blob, name };

    entryCache.set(key, result);
    return result;
  }
  finally {
    await reader.close();
  }
}

export function clearArchiveCache() {
  archiveCache.clear();
  entryCache.clear();
}
