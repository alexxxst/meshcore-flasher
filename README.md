# MeshCore СПб — прошивальщик нод

Статический веб-прошивальщик нод MeshCore для сообщества Санкт-Петербурга.
Сделан на базе [meshcore-dev/flasher.meshcore.io](https://github.com/meshcore-dev/flasher.meshcore.io)
(MIT), без сборки и без внешних CDN.

Сайт рассчитан на размещение в подкаталоге:

```text
https://meshcore.spb.ru/flasher/
```

Прошивки не хранятся в проекте: `config.json` ссылается на ZIP-архивы
в `/wiki/_media/wiki/files/`, а браузер скачивает и распаковывает их
через `lib/zip.min.js`.

## Что умеет

- каталог устройств: репитеры и наблюдатели;
- сценарий «устройство → роль → версия → прошивка»;
- все версии и варианты прошивок в одном селекторе:
  `v1.18 · BL+PS+TS`, `v1.18 · BL+PS`, `v1.18 · PR2343`,
  `v1.17.1 · PR2343`, `v1.16 · PR2343`, observer `v1.18` / `v1.16` /
  `v1.16 · CAD`;
- ссылка на рекомендуемые настройки репитера;
- ссылки на актуальные настройки сети (`/wiki/settings`) в футере и на
  экране репитера/наблюдателя; на главной не дублируются радио-параметры
  текстом — только ссылка;
- ESP32: merged-прошивка с очисткой или upgrade-прошивка обновлением;
- nRF52: OTA-пакет через DFU, `.uf2` для ручного DFU;
  для плат с USB-serial мостом (например, Heltec T096/T114) вход в DFU
  ручной — двойной RST; после этого работает и serial DFU через кнопку
  «Прошить!», и drag & drop `.uf2`. Такие платы помечены в конфиге
  `"dfu": "manual"`, и кнопка «Войти в DFU» для них скрыта;
- Custom Firmware: `.bin` для ESP32, OTA `.zip` для nRF52;
- предупреждение и обязательное подтверждение для observer-прошивки;
- MTL-1 и MTL-2 — одна плата с отдельными блоками 868/433;
- мосты ESPNow — отдельный блок ролей внутри Heltec v4 / MTL-1,
  а не отдельные устройства в списке;
- встроенная последовательная консоль: тёмный терминал, чип статуса
  «Подключено / Отключено», поле ввода блокируется, пока порт не открыт,
  справка команд в `datalist`; команды отправляются с одним CR —
  так их ждут прошивки MeshCore;
- ссылка на конфигуратор `https://config.meshcore.io` (как в оригинале);
- hash-роутинг, поэтому серверу не нужен catch-all;
- светлая тема и логотип MeshCore Санкт-Петербург;
- шапка с логотипом всегда видна, логотип и название ведут на главную wiki;
- «Настройка» и «Консоль» доступны в шапке на всех экранах.

## Быстрый запуск

Web Serial работает только на `localhost` или HTTPS, в Chrome/Edge desktop.

```bash
python3 -m http.server 8000
# открыть http://localhost:8000/
```

Чтобы проверить именно подкаталог и same-origin ZIP, запустите сервер
из родительской папки, где лежит `flasher/`:

```bash
python3 -m http.server 8000
# открыть http://localhost:8000/flasher/
```

Для локальной проверки ZIP создайте рядом:

```text
wiki/_media/wiki/files/
```

и положите туда несколько архивов с wiki. В продакшене эта папка уже
существует на `meshcore.spb.ru`.

## Структура

```text
index.html
flasher.js
config.json              # генерируется: tools/build-config.sh (или build_config.py)
css/
  beer.css               # локальный BeerCSS
  theme.css              # палитра СПб
  flasher.css            # layout и компоненты
js/
  app.js                 # состояние и сценарии
  catalog.js             # загрузка каталога
  firmware.js            # чистые функции выбора файлов (тесты)
  flash.js               # ESP32 / nRF52
  router.js              # hash-роутинг
  serial.js              # Web Serial
  site.js                # константы
  util.js
  zip-loader.js          # fetch + zip.js + кэш
lib/                     # Vue, BeerCSS, esptool, DFU, zip.js, консоль
img/                     # логотип, иконки, mtl_1.webp, mtl_2_*.webp
tools/
  build-config.sh        # папка с ZIP → config.json (основной путь, bash)
  catalog.devices.tsv    # таблица плат: токен, название, тип, dfu, иконка
  catalog.versions.tsv   # таблица версий: суффикс, подпись, текст notes
  catalog.filesets.tsv   # какие файлы внутри ZIP как прошивать
  catalog.common.json    # блоки role / firmwareClass / notice
  firmware-manifest.json # резервный источник истины по прошивкам
  build_config.py        # manifest → config.json; --tables → tools/catalog.*
  check_config.py        # проверка ZIP на wiki
  test_build_config.py   # тесты генератора
tests/
  build-config.test.sh   # проверка сборки конфига из имён архивов
  firmware.test.mjs      # тесты выбора файлов и адресов
```

## Как обновить прошивки

Основной путь — собрать конфиг прямо из папки с архивами на хосте:

```bash
# посмотреть, актуален ли config.json
tools/build-config.sh /var/www/meshcore.spb.ru/wiki/_media/wiki/files --check

# пересобрать
tools/build-config.sh /var/www/meshcore.spb.ru/wiki/_media/wiki/files
```

Нужен только bash с `awk`, `sed`, `sort`, `cmp` — ни python, ни jq,
ни unzip. Внутрь архивов скрипт не заглядывает: `files[]` — это
фиксированные regex по типу платы (`esp32` / `nrf52`).

Всё, что выводится из имени файла, выводится из него:

```text
<токен платы>[_bridge_espnow][_mqtt]-v<версия>[_суффикс].zip
heltec_v4_repeater_bridge_espnow_mqtt-v1.16_cad.zip
mtl_1_sx1268_repeater-v1.18-bl-ps-ts.zip
```

Остальное лежит в таблицах, их и правят руками:

- `tools/catalog.devices.tsv` — платы: токен, название, тип, dfu, иконка,
  tooltip; для MTL — ещё `class_prefix` и диапазон;
- `tools/catalog.versions.tsv` — версии: суффикс имени, подпись в
  селекторе, текст «что внутри», версия MeshCore;
- `tools/catalog.filesets.tsv` — какие файлы внутри ZIP как прошивать;
- `tools/catalog.common.json` — блоки `role`, `firmwareClass`, `notice`.

Порядок строк в таблицах = порядок в интерфейсе.

Параметры скрипта:

```text
--out FILE     куда писать (по умолчанию config.json в корне проекта)
--base URL     firmwareBase (по умолчанию ../wiki/_media/wiki/files/)
--check        не писать, а сравнить с --out; код 1, если устарел
--strict       считать предупреждения ошибками
--devices/--versions/--filesets/--common FILE  подменить таблицу
```

Незнакомые файлы в папке скрипт не глотает молча: печатает
`предупреждение: …` и продолжает; с `--strict` падает.

### Резервный путь через манифест

`tools/firmware-manifest.json` и `tools/build_config.py` остались на
случай, если нужно собрать конфиг без папки с архивами:

```bash
python3 tools/build_config.py            # config.json из манифеста
python3 tools/build_config.py --tables   # пересобрать tools/catalog.* из манифеста
```

Второй вызов важен: если правите манифест, сначала обновите таблицы,
иначе `build-config.sh --check` покажет расхождение.

### Проверка архивов

```bash
python3 tools/check_config.py     # скачивает все ZIP и проверяет regex
```

### Тесты

```bash
node --test tests/
bash tests/build-config.test.sh
cd tools && python3 -m unittest test_build_config -v
```

## Как добавить компаньона

Роли `companionBle` и `companionUsb` уже есть в конфиге. Чтобы добавить
прошивку:

1. В `tools/firmware-manifest.json` добавьте запись в `devices[].firmware`:

```json
{
  "role": "companionBle",
  "versions": {
    "v1.18": {
      "archive": "heltec_v3_companion_radio_ble-v1.18.zip",
      "fileSet": "esp32",
      "notes": "Компаньон Bluetooth."
    }
  }
}
```

2. Для ESP32 используйте `fileSet: "esp32"` (merged + update),
   для nRF52 — `fileSet: "nrf52"` (OTA zip + uf2). Если у компаньона
   другая структура архива, добавьте новый `fileSet` в манифест.
   Для nRF52-плат с USB-serial мостом (T096/T114) укажите
   `"dfu": "manual"` — тогда UI скроет кнопку 1200-baud DFU и подскажет
   двойной RST; после него работают и «Прошить!», и UF2.
3. Запустите `python3 tools/build_config.py`.
4. Проверьте `python3 tools/check_config.py`.

Код менять не нужно: роль и заголовок берутся из `config.role`.

## Деплой

Скопируйте содержимое проекта в `flasher/` на сайте:

```text
/var/www/meshcore.spb.ru/flasher/
```

Никаких сборок и зависимостей на сервере не требуется. Важно, чтобы
`/wiki/_media/wiki/files/` был доступен с того же origin.

Если сайт переедет на другой домен, поменяйте `firmwareBase` в
`tools/firmware-manifest.json` на локальную папку `firmware/` и
положите архивы туда — `zip-loader.js` уже умеет работать с любым URL.

## Тесты и проверки

```bash
node --test tests/          # 17 тестов: прошивки, файлы, консоль
bash tests/build-config.test.sh
cd tools && python3 -m unittest test_build_config -v
python3 tools/check_config.py
```

`tests/build-config.test.sh` собирает конфиг из 77 имён архивов (пустые
файлы) и сверяет с `config.json`, плюс проверяет предупреждения и
`--strict`.

`check_config.py` скачивает все 77 архивов и проверяет, что внутри
находятся файлы, подходящие под regex из конфига. Для быстрой проверки
только доступности используйте `python3 tools/check_config.py --head`.

## Изображения устройств

- MTL-1 (включая bridge-роли): 3D-рендер `var1-01.PNG` из репозитория
  [kt314-sh/MTL-01-01](https://github.com/kt314-sh/MTL-01-01),
  сохранён как `img/mtl_1.webp`.
- MTL-2 868: фото `08.jpg` из репозитория
  [kt314-sh/MTL-2](https://github.com/kt314-sh/MTL-2) — `img/mtl_2_868.webp`.
- MTL-2 433: фото `22.jpg` из того же репозитория — `img/mtl_2_433.webp`.

## TODO

- [ ] При обновлении прошивок на wiki обновить `firmware-manifest.json`
      и прогнать `check_config.py`.
- [ ] Официальные companion-прошивки с flasher.meshcore.io пока не
      добавлены: официальный сайт не отдаёт CORS, нужен same-origin
      прокси или зеркало.
- [ ] Финальный визуальный проход при необходимости.

## Проверено на железе

- **Heltec V4.3 OLED** (ESP32-S3, 16 МБ): прошиты и сверены по SHA-256
  repeater upgrade, repeater merged, observer upgrade, observer merged.
  Адреса: merged — `0x0`, upgrade — `0x10000`.
- **Heltec T096** (nRF52, USB-serial мост HT-n5262G): проверены оба
  пути — drag & drop `.uf2` и serial DFU через кнопку «Прошить!» в
  веб-флашере после двойного RST. После перезагрузки:
  `v1.18-bl-ps-ts-meshcore.spb.ru-9739451d`, `board -> Heltec T096`.
  Скачивание UF2 через веб-флашер проверено, SHA-256 совпал с прошитым
  файлом.

Проверка на железе ограничена этими двумя типами (ESP32 и nRF52);
остальные платы из каталога не тестировались.

### Консоль

Код консоли проверен юнит-тестом (`lib/console.js` с фейковым портом:
подключение, чтение, запись команды `\r\n`, отключение) и в браузере:
тёмный терминал, читаемый текст, поле ввода внизу, чип «Подключено»,
поле блокируется до открытия порта и при ошибке подключения.

На реальном ESP32 консоль может быть пустой, если плата подключена
через **нативный USB-JTAG** порт: прошивка MeshCore выводит CLI в UART0,
а USB-дескриптор остаётся `USB JTAG_serial debug unit`. В этом случае
`ver`/`board` не отвечают, хотя прошивка работает. Для консоли нужен
порт USB-UART (мост CH343/CP210x) или сборка с `ARDUINO_USB_CDC_ON_BOOT=1`.


## Аналитика

В `index.html` перед `</body>` стоит счётчик Яндекс.Метрики
**108159015** — тот же, что на wiki, с параметрами `ssr`, `clickmap`,
`ecommerce: dataLayer`, `accurateTrackBounce`, `trackLinks`.

Счётчик обёрнут в проверку, чтобы локальные запуски не попадали в
боевую статистику:

```js
if (location.hostname !== 'meshcore.spb.ru') return;
```

`noscript`-пиксель `https://mc.yandex.ru/watch/108159015` добавлен без
условия — он срабатывает только при отключённом JS.

## Ограничения

- Web Serial: Chrome/Edge desktop. На Android есть WebUSB-polyfill,
  на iOS/Safari — нет.
- Observer-прошивка предназначена для CoreScope Санкт-Петербурга.
- В nRF52-архивах с wiki нет отдельной erase/bootloader-прошивки.
- Имена ZIP на wiki могут измениться — их ловит `check_config.py`.
- Консоль требует, чтобы CLI ноды был доступен на выбранном порту;
  через нативный USB-JTAG порт ESP32-S3 ответа не будет (см. выше).
- Внешние запросы: ZIP с `/wiki/_media/wiki/files/` (same-origin) и,
  на `meshcore.spb.ru`, скрипт Метрики с `mc.yandex.ru`.

## Лицензия и благодарности

- Код основан на [meshcore-dev/flasher.meshcore.io](https://github.com/meshcore-dev/flasher.meshcore.io),
  лицензия MIT (см. `LICENSE`).
- Логотип и материалы wiki: © MeshCore Санкт-Петербург.
- Material Symbols: Apache 2.0.
- BeerCSS, Vue, esptool.js, zip.js, adafruit-nrfutil-совместимый DFU —
  авторам соответствующих проектов.
