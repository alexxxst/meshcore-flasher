#!/usr/bin/env bash
#
# build-config.sh — собирает config.json для прошивальщика MeshCore СПб
# из папки с ZIP-архивами прошивок.
#
# Зависимости: bash, awk, sed, sort, cmp, mktemp. Без python и jq.
# Совместим с bash 3.2 (macOS) и bash 4/5 (Linux).
#
#   tools/build-config.sh DIR [параметры]
#
# Всё, что можно вывести из имени архива, выводится из него:
#
#   <токен платы>[_bridge_espnow][_mqtt]-v<версия>[_суффикс].zip
#   heltec_v4_repeater_bridge_espnow_mqtt-v1.16_cad.zip
#   mtl_1_sx1268_repeater-v1.18-bl-ps-ts.zip
#
# Остальное (названия плат, иконки, подписи версий, тексты) лежит рядом
# в таблицах tools/catalog.*.tsv и tools/catalog.common.json.
#
set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
TAB=$(printf '\t')

FW_DIR=''
OUT_FILE="$ROOT_DIR/config.json"
BASE_URL='../wiki/_media/wiki/files/'
DEVICES_TSV="$SCRIPT_DIR/catalog.devices.tsv"
VERSIONS_TSV="$SCRIPT_DIR/catalog.versions.tsv"
FILESETS_TSV="$SCRIPT_DIR/catalog.filesets.tsv"
COMMON_JSON="$SCRIPT_DIR/catalog.common.json"
CHECK=0
STRICT=0

usage() {
  cat <<'USAGE'
Собирает config.json из папки с архивами прошивок.

Использование:
  tools/build-config.sh DIR [параметры]

  DIR                папка с архивами *.zip
                     (обычно wiki/_media/wiki/files)

Параметры:
  --out FILE         куда писать; по умолчанию config.json в корне проекта
  --base URL         значение firmwareBase;
                     по умолчанию ../wiki/_media/wiki/files/
  --check            ничего не писать, сравнить с --out и вернуть 1,
                     если config.json устарел
  --strict           считать предупреждения ошибками
  --devices FILE     таблица плат  (tools/catalog.devices.tsv)
  --versions FILE    таблица версий (tools/catalog.versions.tsv)
  --filesets FILE    наборы файлов (tools/catalog.filesets.tsv)
  --common FILE      блоки role/firmwareClass/notice
                     (tools/catalog.common.json)
  -h, --help         эта справка
USAGE
}

warn() { printf 'предупреждение: %s\n' "$*" >&2; }
die() { printf 'ошибка: %s\n' "$*" >&2; exit 1; }

# --- разбор параметров -------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --out|--base|--devices|--versions|--filesets|--common)
      [ $# -ge 2 ] || die "параметру $1 нужно значение"
      case "$1" in
        --out) OUT_FILE=$2 ;;
        --base) BASE_URL=$2 ;;
        --devices) DEVICES_TSV=$2 ;;
        --versions) VERSIONS_TSV=$2 ;;
        --filesets) FILESETS_TSV=$2 ;;
        --common) COMMON_JSON=$2 ;;
      esac
      shift 2
      ;;
    --check) CHECK=1; shift ;;
    --strict) STRICT=1; shift ;;
    -*) die "неизвестный параметр: $1 (см. --help)" ;;
    *)
      [ -z "$FW_DIR" ] || die "лишний аргумент: $1"
      FW_DIR=$1
      shift
      ;;
  esac
done

if [ -z "$FW_DIR" ]; then
  usage >&2
  exit 2
fi

[ -d "$FW_DIR" ] || die "нет такой папки: $FW_DIR"
for f in "$DEVICES_TSV" "$VERSIONS_TSV" "$FILESETS_TSV" "$COMMON_JSON"; do
  [ -f "$f" ] || die "не найден файл: $f"
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/build-config.XXXXXX") || die "не удалось создать временную папку"
trap 'rm -rf "$WORK"' EXIT INT TERM

# --- утилиты -----------------------------------------------------------

# JSON-экранирование значения без кавычек.
esc() {
  printf '%s' "$1" | sed -e 's/\r$//' -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Строка таблицы плат по токену.
device_row() {
  awk -F'\t' -v t="$1" '
    /^[[:space:]]*#/ { next }
    NF < 9 { next }
    $1 == t { print; exit }
  ' "$DEVICES_TSV"
}

# Порядковый номер устройства (по первому появлению названия в таблице).
device_order() {
  awk -F'\t' -v n="$1" '
    /^[[:space:]]*#/ { next }
    NF < 9 { next }
    { if (!($2 in seen)) { seen[$2] = 1; idx++ } }
    $2 == n { print idx; exit }
  ' "$DEVICES_TSV"
}

# Строка таблицы версий по суффиксу.
version_row() {
  awk -F'\t' -v s="$1" '
    /^[[:space:]]*#/ { next }
    NF < 5 { next }
    $1 == s { print; exit }
  ' "$VERSIONS_TSV"
}

# Порядковый номер суффикса в таблице версий.
version_order() {
  awk -F'\t' -v s="$1" '
    /^[[:space:]]*#/ { next }
    NF < 5 { next }
    { n++ }
    $1 == s { print n; exit }
  ' "$VERSIONS_TSV"
}

# --- разбор имён архивов -----------------------------------------------

# Из имени файла достаёт токен платы, суффикс версии и признаки.
# Результат в глобальных переменных A_TOKEN, A_SUFFIX, A_BRIDGE, A_OBS.
parse_archive() {
  local stem head

  case "$1" in
    *.zip) stem=${1%.zip} ;;
    *) return 1 ;;
  esac

  # отрезаем хвост начиная с "-v<цифра>"
  case "$stem" in
    *-v[0-9]*) ;;
    *) return 1 ;;
  esac
  head=${stem%%-v[0-9]*}
  A_SUFFIX=${stem#"$head"-}

  A_BRIDGE=0
  A_OBS=0
  case "$head" in
    *_bridge_espnow_mqtt)
      A_BRIDGE=1
      A_OBS=1
      head=${head%_bridge_espnow_mqtt}
      ;;
    *_bridge_espnow)
      A_BRIDGE=1
      head=${head%_bridge_espnow}
      ;;
    *_mqtt)
      A_OBS=1
      head=${head%_mqtt}
      ;;
  esac

  case "$head" in
    *_repeater) head=${head%_repeater} ;;
    *) return 1 ;;
  esac

  A_TOKEN=$head
  return 0
}

# --- сбор строк --------------------------------------------------------

: > "$WORK/rows"
total=0
skipped=0

for path in "$FW_DIR"/*.zip; do
  [ -e "$path" ] || continue
  name=$(basename -- "$path")

  if ! parse_archive "$name"; then
    skipped=$((skipped + 1))
    warn "не разобрал имя файла: $name"
    continue
  fi

  row=$(device_row "$A_TOKEN")
  if [ -z "$row" ]; then
    skipped=$((skipped + 1))
    warn "плата '$A_TOKEN' не описана в $(basename -- "$DEVICES_TSV"): $name"
    continue
  fi

  dev_name=$(printf '%s\n' "$row" | cut -f2)
  maker=$(printf '%s\n' "$row" | cut -f3)
  dtype=$(printf '%s\n' "$row" | cut -f4)
  dfu=$(printf '%s\n' "$row" | cut -f5)
  cprefix=$(printf '%s\n' "$row" | cut -f6)
  band=$(printf '%s\n' "$row" | cut -f7)
  icon=$(printf '%s\n' "$row" | cut -f8)
  tooltip=$(printf '%s\n' "$row" | cut -f9)

  [ "$cprefix" = '-' ] && cprefix=''
  [ "$band" = '-' ] && band=''

  vrow=$(version_row "$A_SUFFIX")
  if [ -z "$vrow" ]; then
    skipped=$((skipped + 1))
    warn "версия '$A_SUFFIX' не описана в $(basename -- "$VERSIONS_TSV"): $name"
    continue
  fi

  label=$(printf '%s\n' "$vrow" | cut -f2)
  vkind=$(printf '%s\n' "$vrow" | cut -f3)
  features=$(printf '%s\n' "$vrow" | cut -f4)
  source=$(printf '%s\n' "$vrow" | cut -f5)

  # роль и класс
  if [ -n "$cprefix" ]; then
    role="${cprefix}_${band}"
    [ "$A_BRIDGE" = 1 ] && role="${role}_bridge"
    if [ "$A_OBS" = 1 ]; then role="${role}_observer"; else role="${role}_repeater"; fi
    cls="${cprefix}-${band}"
    [ "$A_BRIDGE" = 1 ] && cls="${cls}-bridge"
  elif [ "$A_BRIDGE" = 1 ]; then
    if [ "$A_OBS" = 1 ]; then role=bridgeObserver; else role=bridgeRepeater; fi
    cls=bridge
  else
    if [ "$A_OBS" = 1 ]; then role=observer; else role=repeater; fi
    cls=spb
  fi

  # сверяем таблицу версий с именем файла
  if [ "$A_OBS" = 1 ] && [ "$vkind" != observer ]; then
    warn "в имени '$name' наблюдатель, а версия '$A_SUFFIX' помечена как $vkind"
  fi
  if [ "$A_OBS" = 0 ] && [ "$vkind" = observer ]; then
    warn "в имени '$name' репитер, а версия '$A_SUFFIX' помечена как observer"
  fi

  notes="${features}. Собрано из MeshCore ${source}."
  if [ "$A_BRIDGE" = 1 ]; then
    if [ "$A_OBS" = 1 ]; then notes="Мост ESPNow, ${notes}"; else notes="Мост ESPNow. ${notes}"; fi
  fi

  devord=$(device_order "$dev_name")
  verord=$(version_order "$A_SUFFIX")

  # ключ сортировки ролей: мосты после обычных, 868 перед 433, репитер перед наблюдателем
  bandord=0
  [ "$band" = '433' ] && bandord=1
  if [ "$A_OBS" = 1 ]; then kindord=1; else kindord=0; fi
  roleord=$(( A_BRIDGE * 4 + bandord * 2 + kindord ))

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$devord" "$roleord" "$verord" \
    "$(esc "$dev_name")" "$(esc "$maker")" "$(esc "$dtype")" "$(esc "$dfu")" \
    "$(esc "$icon")" "$(esc "$tooltip")" \
    "$role" "$cls" "$dtype" \
    "$(esc "$label")" "$(esc "$name")" "$(esc "$notes")" >> "$WORK/rows"

  total=$((total + 1))
done

if [ "$total" -eq 0 ]; then
  die "в папке $FW_DIR не нашлось ни одного знакомого архива"
fi

if [ "$skipped" -gt 0 ] && [ "$STRICT" = 1 ]; then
  die "пропущено файлов: $skipped (режим --strict)"
fi

# --- генерация JSON ----------------------------------------------------

sort -t "$TAB" -k1,1n -k2,2n -k3,3n "$WORK/rows" > "$WORK/rows.sorted"

# в JSON обратный слэш удваивается: -merged\.bin$ -> -merged\\.bin$
sed 's/\\/\\\\/g' "$FILESETS_TSV" > "$WORK/filesets.esc"

awk -F'\t' -v outdir="$WORK" '
  FNR == NR {
    if ($0 ~ /^[[:space:]]*#/ || NF < 4) next
    n[$1]++
    ftype[$1, n[$1]] = $2
    fmatch[$1, n[$1]] = $3
    ftitle[$1, n[$1]] = $4
    next
  }

  function open_device(name, maker, type, dfu, icon, tooltip) {
    devno++
    out = sprintf("%s/dev_%03d.json", outdir, devno)
    printf "    {\n" > out
    printf "      \"name\": \"%s\",\n", name > out
    printf "      \"maker\": \"%s\",\n", maker > out
    printf "      \"type\": \"%s\",\n", type > out
    printf "      \"dfu\": \"%s\",\n", dfu > out
    printf "      \"icon\": \"%s\",\n", icon > out
    printf "      \"tooltip\": \"%s\",\n", tooltip > out
    printf "      \"firmware\": [\n" > out
    firstrole = 1
    current = out
  }

  function open_role(cls, role) {
    if (!firstrole) printf "        },\n" > current
    printf "        {\n" > current
    printf "          \"class\": \"%s\",\n", cls > current
    printf "          \"role\": \"%s\",\n", role > current
    printf "          \"version\": {\n" > current
    firstrole = 0
    firstver = 1
  }

  function open_version(label, archive, notes, fileset) {
    if (!firstver) printf "            },\n" > current
    printf "            \"%s\": {\n", label > current
    printf "              \"archive\": \"%s\",\n", archive > current
    printf "              \"notes\": \"%s\",\n", notes > current
    printf "              \"files\": [\n" > current
    for (i = 1; i <= n[fileset]; i++) {
      printf "                {\n" > current
      printf "                  \"type\": \"%s\",\n", ftype[fileset, i] > current
      printf "                  \"match\": \"%s\",\n", fmatch[fileset, i] > current
      printf "                  \"title\": \"%s\"\n", ftitle[fileset, i] > current
      if (i < n[fileset]) printf "                },\n" > current
      else printf "                }\n" > current
    }
    printf "              ]\n" > current
    firstver = 0
  }

  {
    if ($0 ~ /^[[:space:]]*#/ || NF < 15) next

    dev = $4
    role = $10

    if (dev != curdev) {
      if (curdev != "") {
        printf "            }\n" > current
        printf "          }\n" > current
        printf "        }\n" > current
        printf "      ]\n" > current
        printf "    },\n" > current
      }
      open_device($4, $5, $6, $7, $8, $9)
      curdev = dev
      currole = ""
    }

    if (role != currole) {
      if (currole != "") {
        printf "            }\n" > current
        printf "          }\n" > current
      }
      open_role($11, role)
      currole = role
    }

    open_version($13, $14, $15, $12)
  }

  END {
    printf "            }\n" > current
    printf "          }\n" > current
    printf "        }\n" > current
    printf "      ]\n" > current
    printf "    }\n" > current
  }
' "$WORK/filesets.esc" "$WORK/rows.sorted"

# --- сборка файла ------------------------------------------------------

{
  printf '{\n'
  printf '  "firmwareBase": "%s",\n' "$(esc "$BASE_URL")"
  cat "$COMMON_JSON"
  printf '  "device": [\n'
  for f in "$WORK"/dev_*.json; do
    [ -e "$f" ] || continue
    cat "$f"
  done
  printf '  ]\n'
  printf '}\n'
} > "$WORK/config.json"

# --- результат ---------------------------------------------------------

if [ "$CHECK" -eq 1 ]; then
  if cmp -s "$WORK/config.json" "$OUT_FILE"; then
    printf 'config.json актуален (%s архивов)\n' "$total"
    exit 0
  fi
  printf 'config.json устарел: %s\n' "$OUT_FILE" >&2
  if command -v diff >/dev/null 2>&1; then
    diff -u "$OUT_FILE" "$WORK/config.json" | head -40 >&2
  fi
  exit 1
fi

mkdir -p "$(dirname -- "$OUT_FILE")"
cat "$WORK/config.json" > "$OUT_FILE"
printf 'записал %s: %s архивов, %s устройств\n' \
  "$OUT_FILE" "$total" "$(grep -c '"name":' "$WORK/config.json")"
