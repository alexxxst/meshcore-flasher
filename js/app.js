import { reactive, ref, shallowRef, nextTick, watch, computed } from '../lib/vue.min.js?v=844bfa7eda';
import { SerialConsole } from '../lib/console.js?v=844bfa7eda';
import { commandReference } from './commands.js?v=844bfa7eda';
import { hasVersions, roleValue, renderNotice, formatNotes } from './catalog.js?v=844bfa7eda';
import { pickFirmwareFile, requiresObserverConfirmation, isMergedFilename, resolveArchiveUrl, esp32Address, bandOf } from './firmware.js?v=844bfa7eda';
import { Dfu, flashEsp32, flashNrf52, releaseFlasher } from './flash.js?v=844bfa7eda';
import { CONSOLE_PATH, buildPath, parsePath, isSamePage, pathFromHash, hashForPath } from './router.js?v=844bfa7eda';
import { serialAPI, serialSupported } from './serial.js?v=844bfa7eda';
import { logoFile, siteTitle, siteSubtitle, wikiExperimentUrl, wikiCompanionFlashUrl, wikiRepeaterFlashUrl, wikiRepeaterSettingsUrl, wikiSettingsUrl, wikiObserverUrl, officialFlasherUrl, wikiNrf52Url, nrfEraseArchive, nrfEraseUf2, esp32CompanionWifiNote } from './site.js?v=844bfa7eda';
import { loadArchiveEntry } from './zip-loader.js?v=844bfa7eda';

const WEB_SERIAL_UNSUPPORTED = 'Браузер не поддерживает Web Serial. Откройте сайт в Chrome или Edge на компьютере.';

export function createSetup(config) {
  return function setup() {
    const consoleEditBox = ref();
    const consoleWindow = ref();
    const deviceFilterText = ref('');
    // device tooltips embed large SVG pictures, so only the hovered one is rendered
    const hoveredDevice = shallowRef(null);

    const snackbar = reactive({ text: '', class: '', icon: '' });
    const archiveBusy = ref(false);
    const archiveProgress = ref(0);

    const selected = reactive({
      device: null,
      firmware: null,
      version: null,
      firmwareClass: null,
      wipe: false,
      observerConfirmed: false,
    });

    const flashing = reactive({
      supported: serialSupported,
      instance: null,
      active: false,
      percent: 0,
      log: '',
      error: '',
      dfuComplete: false,
      eraseDone: false,
    });

    const serialCon = reactive({
      instance: null,
      opened: false,
      connected: false,
      connecting: false,
      content: '',
      edit: '',
    });

    window.app = { selected, flashing, serialCon };

    const firmwareClasses = config.firmwareClass ?? {};
    const firmwareBase = new URL(config.firmwareBase, document.baseURI).href;
    const asset = (path) => new URL(path, document.baseURI).href;

    const log = {
      clean() { flashing.log = ''; },
      write(data) { flashing.log += data; },
      writeLine(data) { flashing.log += data + '\n'; },
    };

    // --- catalog views ---

    const fwValue = (firmware, key) => roleValue(config, firmware, key);
    const currentVersion = computed(() => selected.firmware?.version[selected.version] ?? null);
    const currentArchiveUrl = computed(() => currentVersion.value?.archive ? resolveArchiveUrl(firmwareBase, currentVersion.value.archive) : '');
    const isObserver = computed(() => selected.firmware?.role?.toLowerCase().endsWith('observer') ?? false);
    const isRepeaterRole = computed(() => {
      const role = selected.firmware?.role?.toLowerCase() ?? '';
      return role.includes('repeater') || role.includes('observer');
    });
    const isCompanionRole = computed(() => selected.firmware?.role?.toLowerCase().includes('companion') ?? false);
    // у BLE-компаньонов на ESP32 есть Wi-Fi — дописываем это к описанию роли
    const roleDescription = (firmware) => {
      const text = firmware ? fwValue(firmware, 'tooltip') : '';
      const role = firmware?.role?.toLowerCase() ?? '';
      if (role.includes('companion') && selected.device?.type === 'esp32') {
        return text ? `${text} ${esp32CompanionWifiNote}` : esp32CompanionWifiNote;
      }
      return text;
    };
    const needsConfirmation = computed(() => selected.firmware ? requiresObserverConfirmation(selected.firmware.role) : false);
    const canFlash = computed(() => (!needsConfirmation.value || selected.observerConfirmed) && !archiveBusy.value);

    const roleNotice = computed(() => {
      if (!selected.firmware) return '';
      const key = selected.firmware.notice ?? (isObserver.value ? 'observer' : null);
      return key ? renderNotice(config, selected.device, { ...selected.firmware, notice: key }) : '';
    });
    const switchNotice = computed(() => {
      const notices = config.notice ?? {};
      const nrf = selected.device?.type === 'nrf52';
      if (isCompanionRole.value) {
        return (nrf ? notices.switchTypeCompanionNrf52 : notices.switchTypeCompanion)
          ?? notices.switchType ?? '';
      }
      return (nrf ? notices.switchTypeNrf52 : notices.switchType) ?? '';
    });

    const devices = computed(() => {
      const filter = deviceFilterText.value.toLowerCase();
      return config.device
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .filter((d) => d.name.toLowerCase().includes(filter));
    });

    const deviceFirmwareByClass = computed(() => {
      if (!selected.device) return {};
      const groups = {};
      for (const fw of selected.device.firmware) {
        if (!hasVersions(fw)) continue;
        if (selected.firmwareClass && fw.class !== selected.firmwareClass) continue;
        (groups[fw.class || 'other'] ??= []).push(fw);
      }
      // known classes first, in their defined order
      const order = [...Object.keys(firmwareClasses), ...Object.keys(groups)];
      return Object.fromEntries([...new Set(order)].filter((cls) => groups[cls]).map((cls) => [cls, groups[cls]]));
    });

    const versionOptions = computed(() => {
      if (!selected.firmware) return [];
      return Object.keys(selected.firmware.version)
        .filter((version) => selected.firmware.version[version].files.length > 0);
    });

    const firmwareBand = computed(() => {
      if (!selected.firmware || selected.firmware.role === 'custom') return '';
      return bandOf(selected.firmware);
    });

    const firmwareBandDefault = computed(() => {
      if (!firmwareBand.value) return false;
      const cls = String(selected.firmware?.class ?? '');
      const role = String(selected.firmware?.role ?? '');
      return !/-\d{3}(?:-bridge)?$/.test(cls) && !/_\d{3}_/.test(role);
    });

    const downloads = computed(() => {
      if (!currentVersion.value || currentVersion.value.customFile) return [];
      const items = [];
      if (currentArchiveUrl.value) {
        items.push({ title: 'Скачать ZIP-архив', href: currentArchiveUrl.value });
      }
      for (const file of currentVersion.value.files) {
        if (file.file) continue;
        items.push({ title: `Скачать ${file.title}`, action: 'extract', file });
      }
      if (selected.device?.type === 'nrf52') {
        items.push({ title: 'Скачать файл стирания flash (UF2)', href: asset(nrfEraseUf2) });
      }
      return items;
    });

    // --- navigation ---

    const selectFirmware = (firmware) => {
      selected.firmware = firmware;
      selected.version = firmware && Object.keys(firmware.version).find((v) => firmware.version[v].files.length > 0);
      selected.wipe = false;
      selected.observerConfirmed = false;
    };

    const selectDevice = (device) => {
      selected.device = device;
      selected.firmware = null;
      selected.version = null;
      selected.firmwareClass = null;
      selected.wipe = false;
      selected.observerConfirmed = false;
    };

    const applySelection = ({ device, firmware, version, firmwareClass }) => {
      selected.device = device;
      selected.firmwareClass = firmwareClass;
      selectFirmware(firmware);
      if (version) selected.version = version;
    };

    const stepBack = () => {
      if (selected.firmware) {
        // custom files have no role screen to go back to
        if (currentVersion.value?.customFile) selected.device = null;
        selectFirmware(null);
        return;
      }
      selected.device = null;
      selected.firmwareClass = null;
      selected.wipe = false;
      selected.observerConfirmed = false;
    };

    const resetFlashing = async () => {
      await releaseFlasher(flashing.instance);
      Object.assign(flashing, { instance: null, active: false, percent: 0, log: '', error: '', dfuComplete: false, eraseDone: false });
    };

    const retry = resetFlashing;
    const close = resetFlashing;

    // --- URL sync ---

    const currentPath = computed(() => {
      if (serialCon.opened) return CONSOLE_PATH;
      // a local file can't be linked to
      if (currentVersion.value?.customFile) return '/';
      return buildPath(config, selected);
    });

    const setLocation = (path, replace) => {
      const hash = hashForPath(path);
      if (location.hash === hash) return;
      history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    };

    watch(currentPath, (path) => {
      if (pathFromHash(location.hash) === path) return;
      setLocation(path, isSamePage(pathFromHash(location.hash), path));
    });

    // the observer confirmation is valid only for the currently selected version
    watch(() => selected.version, () => { selected.observerConfirmed = false; });

    // restores the selection from the hash, then normalizes the hash in place
    const applyLocation = () => {
      applySelection(parsePath(config, pathFromHash(location.hash) || '/'));
      setLocation(currentPath.value, true);
    };

    window.addEventListener('hashchange', () => {
      if (serialCon.opened) closeSerialCon();
      flashing.active = false;
      flashing.log = '';
      flashing.error = '';
      applyLocation();
    });

    applyLocation();

    // --- serial console ---

    const openSerialGUI = () => {
      window.open('https://config.meshcore.io', 'meshcore_config', 'directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=1000,height=800');
    };

    const openSerialCon = async () => {
      if (!serialAPI) {
        showMessage(WEB_SERIAL_UNSUPPORTED, 'warning');
        return;
      }

      let port;
      try {
        port = await serialAPI.requestPort();
      }
      catch (e) {
        console.error(e);
        return;
      }

      const serialConsole = serialCon.instance = new SerialConsole(port);

      const rule = '-'.repeat(30) + '\n';
      serialCon.content =
        rule +
        'Консоль MeshCore.\n' +
        'Кликните в поле ввода, чтобы увидеть поддерживаемые команды.\n' +
        'Начните с команд ver или board.\n' +
        'Если нода молчит, выберите порт USB-UART (CH343/CP210x),\n' +
        'а не «USB JTAG/serial debug unit».\n' +
        rule + '\n';
      serialCon.opened = true;
      serialCon.connected = false;
      serialCon.connecting = true;

      serialConsole.onOutput = (text) => { serialCon.content += text; };
      serialConsole.onStatus = (connected) => {
        serialCon.connected = connected;
        if (connected) serialCon.connecting = false;
      };

      try {
        await serialConsole.connect();
      }
      catch (e) {
        serialCon.content += `\n*** Не удалось подключиться: ${e}\n`;
      }
      finally {
        serialCon.connecting = false;
        await nextTick();
        if (serialCon.connected) consoleEditBox.value?.focus();
      }
    };

    const closeSerialCon = async () => {
      serialCon.opened = false;
      serialCon.connected = false;
      serialCon.connecting = false;
      try {
        await serialCon.instance?.disconnect();
      }
      catch (e) {
        console.error(e);
      }
    };

    const sendCommand = async (text) => {
      if (!serialCon.connected) {
        showMessage('Порт ещё не подключён', 'usb_off');
        return;
      }

      const consoleEl = consoleWindow.value;
      serialCon.edit = '';

      try {
        await serialCon.instance.sendCommand(text);
      }
      catch (e) {
        console.error(e);
        showMessage('Не удалось отправить команду', 'error');
        return;
      }

      setTimeout(() => {
        if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
      }, 100);
    };

    const showMessage = (text, icon = '', displayMs = 2000) => {
      Object.assign(snackbar, { class: 'active', text, icon });
      setTimeout(() => Object.assign(snackbar, { class: '', text: '', icon: '' }), displayMs);
    };

    const consoleMouseUp = () => {
      const selection = window.getSelection().toString();
      if (selection.length) {
        navigator.clipboard.writeText(selection);
        showMessage('Текст скопирован в буфер обмена');
      }
      if (serialCon.connected) consoleEditBox.value?.focus();
    };

    // --- flashing ---

    const dfuMode = async () => {
      if (!serialAPI) {
        showMessage(WEB_SERIAL_UNSUPPORTED, 'warning');
        return;
      }

      try {
        await Dfu.forceDfuMode(await serialAPI.requestPort({}));
        flashing.dfuComplete = true;
      }
      catch (e) {
        console.error(e);
        showMessage('Не удалось перевести устройство в DFU', 'error');
      }
    };

    const isNrf52 = computed(() => selected.device?.type === 'nrf52');

    // Стирание flash у nRF52: официальный пакет FLASH_ERASE_* кладём через DFU.
    // Удаляет настройки, ключи и саму прошивку — после этого ноду надо прошить заново.
    const eraseFlash = async () => {
      if (!serialAPI) {
        showMessage(WEB_SERIAL_UNSUPPORTED, 'warning');
        return;
      }
      if (!isNrf52.value) return;

      const name = selected.device.name;
      if (!confirm(`Стереть flash у «${name}»?\n\nБудут удалены настройки, ключи и прошивка. После стирания ноду нужно прошить заново.`)) {
        return;
      }

      let data;
      try {
        const response = await fetch(asset(nrfEraseArchive));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.blob();
      }
      catch (e) {
        console.error(e);
        showMessage('Не удалось загрузить файл стирания', 'error');
        return;
      }

      let port;
      try {
        port = await serialAPI.requestPort({});
      }
      catch (e) {
        console.error(e);
        showMessage('Порт не выбран', 'usb_off');
        return;
      }

      log.clean();
      flashing.error = '';
      flashing.dfuComplete = false;
      flashing.eraseDone = true;
      flashing.active = true;
      flashing.percent = 0;

      try {
        const dfu = flashing.instance = new Dfu(port);
        await flashNrf52(dfu, data, (percent) => { flashing.percent = percent; });
      }
      catch (e) {
        flashing.eraseDone = false;
        flashing.error = e.message;
      }
    };

    const customFirmwareLoad = (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      ev.target.value = '';

      const esp32 = file.name.endsWith('.bin');
      selected.device = {
        name: 'Своя прошивка',
        type: esp32 ? 'esp32' : 'nrf52',
        icon: '',
      };
      selected.firmwareClass = null;
      selected.wipe = false;
      selected.observerConfirmed = false;

      if (isMergedFilename(file.name)) {
        alert(
          'Вы выбрали файл, который заканчивается на "merged.bin". ' +
          'Он стирает flash и все данные, включая настройки и приватные ключи. ' +
          'Если нужна только прошивка обновлением, выберите обычный .bin.',
        );
        selected.wipe = true;
      }

      selected.firmware = {
        icon: 'unknown_document',
        title: file.name,
        role: 'custom',
        version: {
          [file.name]: {
            customFile: true,
            notes: '',
            files: [{ type: esp32 ? (selected.wipe ? 'flash-wipe' : 'flash-update') : 'flash', file }],
          },
        },
      };
      selected.version = file.name;
    };

    const downloadFile = async (item) => {
      if (item.href) {
        const link = document.createElement('a');
        link.href = item.href;
        link.download = '';
        link.click();
        return;
      }

      if (item.action !== 'extract' || !currentArchiveUrl.value) return;

      try {
        archiveBusy.value = true;
        archiveProgress.value = 0;
        const { blob, name } = await loadArchiveEntry(currentArchiveUrl.value, item.file.match, {
          onProgress: (percent) => { archiveProgress.value = percent; },
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showMessage('Файл скачивается', 'download');
      }
      catch (e) {
        alert(e.message);
      }
      finally {
        archiveBusy.value = false;
      }
    };

    const flashDevice = async () => {
      if (!serialAPI) {
        showMessage(WEB_SERIAL_UNSUPPORTED, 'warning');
        return;
      }

      if (needsConfirmation.value && !selected.observerConfirmed) {
        alert('Подтвердите, что прошивка предназначена для CoreScope Санкт-Петербурга.');
        return;
      }

      const esp32 = selected.device.type === 'esp32';
      const file = pickFirmwareFile(currentVersion.value.files, { esp32, wipe: selected.wipe });
      if (!file) {
        alert('Не удалось найти файл прошивки в конфиге. Сообщите об этом в чат сообщества.');
        return;
      }

      let data;
      try {
        if (file.file) {
          data = file.file;
        }
        else {
          archiveBusy.value = true;
          archiveProgress.value = 0;
          data = (await loadArchiveEntry(currentArchiveUrl.value, file.match, {
            onProgress: (percent) => { archiveProgress.value = percent; },
          })).blob;
        }
      }
      catch (e) {
        alert(e.message);
        return;
      }
      finally {
        archiveBusy.value = false;
      }

      let port;
      try {
        port = await serialAPI.requestPort({});
      }
      catch (e) {
        console.error(e);
        showMessage('Порт не выбран', 'usb_off');
        return;
      }

      const onProgress = (percent) => { flashing.percent = percent; };
      log.clean();
      flashing.error = '';
      flashing.eraseDone = false;
      flashing.active = true;
      flashing.percent = 0;

      try {
        if (esp32) {
          await flashEsp32(port, data, {
            address: esp32Address(file),
            eraseAll: selected.wipe,
            terminal: log,
            onProgress,
            onLoader: (loader) => { flashing.instance = loader; },
          });
        }
        else {
          const dfu = flashing.instance = new Dfu(port);
          await flashNrf52(dfu, data, onProgress);
        }
      }
      catch (e) {
        flashing.error = e.message;
      }
    };

    return {
      config, asset, logoFile, siteTitle, siteSubtitle, wikiExperimentUrl, wikiCompanionFlashUrl, wikiRepeaterFlashUrl, wikiRepeaterSettingsUrl, wikiSettingsUrl, wikiObserverUrl, officialFlasherUrl,
      commandReference, firmwareClasses, WEB_SERIAL_UNSUPPORTED,
      snackbar, archiveBusy, archiveProgress,
      selected, flashing, serialCon, firmwareBand, firmwareBandDefault,
      deviceFilterText, hoveredDevice, devices, deviceFirmwareByClass,
      currentVersion, currentArchiveUrl, roleNotice, switchNotice, needsConfirmation, canFlash, isRepeaterRole, isCompanionRole, isObserver, isNrf52, wikiNrf52Url,
      versionOptions, downloads, fwValue, roleDescription, formatNotes,
      selectDevice, selectFirmware, stepBack, retry, close, downloadFile,
      consoleEditBox, consoleWindow, consoleMouseUp, openSerialCon, closeSerialCon, sendCommand, openSerialGUI,
      dfuMode, eraseFlash, flashDevice, customFirmwareLoad,
    };
  };
}
