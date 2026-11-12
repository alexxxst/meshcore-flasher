#!/usr/bin/env bash
#
# Проверяет, что tools/build-config.sh собирает ровно тот config.json,
# который лежит в проекте, — по именам архивов из самого config.json.
# Содержимое ZIP не читается, поэтому достаточно пустых файлов.
#
#   bash tests/build-config.test.sh
#
set -u

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/build-config-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM

fail=0
ok() { printf 'ok   %s\n' "$*"; }
no() { printf 'FAIL %s\n' "$*"; fail=1; }

# 1. имена архивов из config.json
grep -o '"archive": "[^"]*"' "$ROOT/config.json" |
  sed 's/.*: "//; s/"$//' | sort -u | while IFS= read -r name; do
  [ -n "$name" ] || continue
  : > "$TMP/$name"
done

count=$(find "$TMP" -name '*.zip' | wc -l | tr -d ' ')
[ "$count" -gt 0 ] || { no "не собрал имена архивов из config.json"; exit 1; }

# 2. сборка из этих имён должна совпасть с config.json
if "$ROOT/tools/build-config.sh" "$TMP" --check >/dev/null 2>&1; then
  ok "config.json воспроизводится из $count имён архивов"
else
  no "build-config.sh --check не совпал с config.json"
  "$ROOT/tools/build-config.sh" "$TMP" --check 2>&1 | head -20
fi

# 3. незнакомый файл: предупреждение, но успешный код возврата
: > "$TMP/unknown_board_repeater-v1.18.zip"
if "$ROOT/tools/build-config.sh" "$TMP" --out "$TMP/out.json" >/dev/null 2>"$TMP/warn.txt"; then
  if grep -q 'предупреждение' "$TMP/warn.txt"; then
    ok "незнакомый файл даёт предупреждение"
  else
    no "нет предупреждения про незнакомый файл"
  fi
else
  no "мягкий режим завершился с ошибкой"
fi

# 4. --strict на том же наборе должен упасть
if "$ROOT/tools/build-config.sh" "$TMP" --out "$TMP/out2.json" --strict >/dev/null 2>&1; then
  no "--strict не упал на незнакомом файле"
else
  ok "--strict падает на незнакомом файле"
fi

if [ "$fail" -eq 0 ]; then
  echo 'все проверки прошли'
else
  echo 'есть ошибки'
  exit 1
fi
