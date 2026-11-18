// Flashing backends: esptool.js for ESP32, adafruit-nrfutil style serial DFU for nRF52
import { Dfu } from '../lib/dfu.js?v=844bfa7eda';
import { ESPLoader, Transport, HardReset } from '../lib/esp32.js?v=844bfa7eda';
import { blobToBinaryString, delay } from './util.js?v=844bfa7eda';

export async function downloadFirmware(url) {
  console.log(`downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Не удалось скачать прошивку: HTTP ${res.status}. Попробуйте ещё раз.`);
  }

  return await res.blob();
}

async function pulseRts(transport) {
  await transport.setRTS(true);
  await delay(100);
  await transport.setRTS(false);
}

// onLoader receives the ESPLoader as soon as it exists, so the caller can release the port later
export async function flashEsp32(port, data, { address, eraseAll, terminal, onProgress, onLoader }) {
  const transport = new Transport(port, true);
  const options = {
    transport,
    terminal,
    compress: true,
    eraseAll,
    flashSize: 'keep',
    flashMode: 'keep',
    flashFreq: 'keep',
    baudrate: 115200,
    romBaudrate: 115200,
    enableTracing: false,
    fileArray: [{ data: await blobToBinaryString(data), address }],
    reportProgress: (_, written, total) => onProgress((written / total) * 100),
  };

  const loader = new ESPLoader(options);
  loader.hr = new HardReset(transport);
  onLoader?.(loader);

  try {
    await loader.main();
    await loader.flashId();
  }
  catch (e) {
    console.error(e);
    throw new Error(`Не удалось инициализировать устройство. Переведите его в режим прошивки и попробуйте снова. Детали: ${e}`);
  }

  try {
    await loader.writeFlash(options);
    await delay(100);
    await loader.after('hard_reset');
    await delay(100);
  }
  catch (e) {
    console.error(e);
    throw new Error(`Ошибка прошивки ESP32: ${e}`);
  }
  finally {
    await pulseRts(transport);
    await transport.disconnect();
  }
}

export async function flashNrf52(dfu, data, onProgress) {
  try {
    await dfu.dfuUpdate(data, onProgress);
  }
  catch (e) {
    console.error(e);
    throw new Error(`Ошибка прошивки nRF52: ${e}. Перезагрузите устройство и попробуйте снова.`);
  }
}

// Resets / closes whatever a previous flashing attempt left open
export async function releaseFlasher(instance) {
  try {
    if (instance instanceof ESPLoader) {
      await instance.hr.reset();
      await instance.transport.disconnect();
    }
    else if (instance instanceof Dfu) {
      await instance.port.close();
    }
  }
  catch (e) {
    console.error(e);
  }
}

export { Dfu };
