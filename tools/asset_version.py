#!/usr/bin/env python3
"""Версия в ссылках на CSS и JS (?v=).

nginx отдаёт JS/CSS с Cache-Control: max-age=604800 (7 дней), поэтому после
выкладки браузер продолжает отдавать старые модули. Один токен на все
локальные стили и скрипты делает URL уникальными для каждой версии.

Токен — это хеш содержимого стилей и скриптов (без самих ?v=), поэтому он
меняется только тогда, когда меняется код. Обычно скрипт запускается сам:
хук .githooks/pre-commit обновляет версию перед коммитом, а
.githooks/pre-push проверяет, что она не устарела.

    python3 tools/asset_version.py --auto       # посчитать хеш и проставить
    python3 tools/asset_version.py --check      # проверить согласованность
    python3 tools/asset_version.py 20261113.1   # задать токен вручную

Версионируются: css/*.css и flasher.js в index.html, а также все локальные
импорты в flasher.js, js/*.js, lib/*.js (кроме *.min.js) и lib/polyfill/*.js.
Картинки, шрифты и config.json не трогаем.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path

TOKEN_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]*$")

# <link href="./css/flasher.css"> и <script src="./flasher.js">
INDEX_RE = re.compile(
    r'(?P<pre>(?:href|src)=")'
    r'(?P<spec>\./(?:css/[^"?#\s]+\.css|flasher\.js))'
    r'(?:\?[^"]*)?'
    r'(?P<end>")'
)

# from './x.js', import './x.js', import('./x.js')
JS_RE = re.compile(
    r'(?P<pre>(?:\bfrom\s+|\bimport\s*\(?\s*))'
    r'(?P<q>[\'"])'
    r'(?P<spec>\.{1,2}/[^\'"\s]+?\.js)'
    r'(?:\?[^\'"\s]*)?'
    r'(?P=q)'
)

TOKEN_IN_URL_RE = re.compile(r"\?v=([^\"'&\s)]+)")


def js_files(root: Path) -> list[Path]:
    files = [root / 'flasher.js']
    files += sorted((root / 'js').glob('*.js'))
    files += sorted(p for p in (root / 'lib').glob('*.js') if not p.name.endswith('.min.js'))
    files += sorted((root / 'lib' / 'polyfill').glob('*.js'))
    return [p for p in files if p.is_file()]


def css_files(root: Path) -> list[Path]:
    return sorted(p for p in (root / 'css').glob('*.css') if p.is_file())


def asset_files(root: Path) -> list[Path]:
    return css_files(root) + js_files(root)


def version_index(text: str, token: str) -> str:
    return INDEX_RE.sub(
        lambda m: f"{m.group('pre')}{m.group('spec')}?v={token}{m.group('end')}",
        text,
    )


def version_js(text: str, token: str) -> str:
    return JS_RE.sub(
        lambda m: f"{m.group('pre')}{m.group('q')}{m.group('spec')}?v={token}{m.group('q')}",
        text,
    )


def strip_js_version(text: str) -> str:
    return JS_RE.sub(
        lambda m: f"{m.group('pre')}{m.group('q')}{m.group('spec')}{m.group('q')}",
        text,
    )


def rewrite(root: Path, token: str) -> list[Path]:
    """Ставит токен во всех файлах. Возвращает список изменённых файлов."""
    changed: list[Path] = []
    index = root / 'index.html'
    text = index.read_text(encoding='utf-8')
    new = version_index(text, token)
    if new != text:
        index.write_text(new, encoding='utf-8')
        changed.append(index)
    for path in js_files(root):
        text = path.read_text(encoding='utf-8')
        new = version_js(text, token)
        if new != text:
            path.write_text(new, encoding='utf-8')
            changed.append(path)
    return changed


def is_asset_path(path: str) -> bool:
    if path == 'flasher.js':
        return True
    if path.startswith('css/') and path.endswith('.css'):
        return True
    if path.startswith('js/') and path.endswith('.js'):
        return True
    if path.startswith('lib/') and path.endswith('.js') and not path.endswith('.min.js'):
        return True
    return False


def disk_texts(root: Path) -> dict[str, str]:
    files = {'index.html': (root / 'index.html').read_text(encoding='utf-8')}
    for path in asset_files(root):
        files[str(path.relative_to(root))] = path.read_text(encoding='utf-8')
    return files


def git_texts(root: Path, ref: str) -> dict[str, str]:
    names = subprocess.check_output(
        ['git', '-C', str(root), 'ls-tree', '-r', '--name-only', ref],
        text=True,
    ).splitlines()
    files = {'index.html': subprocess.check_output(
        ['git', '-C', str(root), 'show', f'{ref}:index.html'],
        text=True,
    )}
    for name in names:
        if is_asset_path(name):
            files[name] = subprocess.check_output(
                ['git', '-C', str(root), 'show', f'{ref}:{name}'],
                text=True,
            )
    return files


def content_token_files(files: dict[str, str]) -> str:
    """Хеш содержимого стилей и скриптов без учёта текущих ?v=."""
    digest = hashlib.sha1()
    for name in sorted(files):
        if name == 'index.html':
            continue
        text = files[name]
        if name.endswith('.js'):
            text = strip_js_version(text)
        digest.update(name.encode('utf-8'))
        digest.update(b'\0')
        digest.update(text.encode('utf-8'))
        digest.update(b'\0')
    return digest.hexdigest()[:10]


def content_token(root: Path) -> str:
    return content_token_files(disk_texts(root))


def scan_file(name: str, text: str, pattern: re.Pattern[str],
              tokens: set[str], missing: list[str]) -> None:
    for match in pattern.finditer(text):
        found = TOKEN_IN_URL_RE.search(match.group(0))
        if found:
            tokens.add(found.group(1))
        else:
            missing.append(f'{name}: {match.group("spec")}')


def collect_tokens_files(files: dict[str, str]) -> tuple[set[str], list[str]]:
    tokens: set[str] = set()
    missing: list[str] = []
    scan_file('index.html', files['index.html'], INDEX_RE, tokens, missing)
    for name in sorted(files):
        if name != 'index.html':
            scan_file(name, files[name], JS_RE, tokens, missing)
    return tokens, missing


def check(root: Path, expected: str | None = None,
          ref: str | None = None) -> tuple[bool, str | None, list[str]]:
    """Проверяет, что версия одна и совпадает с хешем содержимого.

    С `ref` (например, HEAD) проверяется закоммиченное дерево, а не рабочая
    копия — чтобы незакоммиченные правки не блокировали push.
    """
    files = git_texts(root, ref) if ref else disk_texts(root)
    tokens, missing = collect_tokens_files(files)
    if expected is None:
        expected = content_token_files(files)
    problems: list[str] = []
    if missing:
        problems += [f'без версии: {m}' for m in missing]
    if len(tokens) > 1:
        problems.append('разные версии: ' + ', '.join(sorted(tokens)))
    if not tokens and not missing:
        problems.append('не найдено ни одной ссылки на стили/скрипты')
    token = next(iter(tokens)) if len(tokens) == 1 else None
    if token != expected:
        problems.append(f'ожидалась версия {expected}, найдена {token or "—"}')
    return (not problems), token, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Версия в ссылках на CSS и JS (?v=).')
    parser.add_argument('token', nargs='?', help='токен версии вручную; без него используется --auto')
    parser.add_argument('--auto', action='store_true',
                        help='посчитать хеш содержимого CSS/JS и проставить его')
    parser.add_argument('--print-changed', action='store_true',
                        help='напечатать изменённые файлы (для git-хука)')
    parser.add_argument('--check', nargs='?', const='', metavar='TOKEN',
                        help='только проверить; можно указать ожидаемый токен')
    parser.add_argument('--ref', metavar='REF',
                        help='с --check проверять закоммиченное дерево (например, HEAD)')
    parser.add_argument('--root', default='.', help='корень проекта (по умолчанию текущий каталог)')
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()

    if args.check is not None:
        try:
            ok, token, problems = check(root, args.check or None, args.ref)
        except (subprocess.CalledProcessError, OSError) as error:
            print(f'не удалось прочитать {args.ref or "рабочую копию"}: {error}', file=sys.stderr)
            return 1
        if ok:
            print(f'ok: все ссылки на стили и скрипты с версией {token}')
            return 0
        print('версии разъехались:', file=sys.stderr)
        for problem in problems:
            print('  - ' + problem, file=sys.stderr)
        return 1

    if args.auto:
        token = content_token(root)
    elif args.token:
        token = args.token
    else:
        parser.error('нужен --auto, токен версии или --check')
    if not TOKEN_RE.match(token):
        parser.error('токен может содержать только буквы, цифры, точку, дефис и подчёркивание')

    changed = rewrite(root, token)
    ok, _token, problems = check(root, token)
    if not ok:
        print('после простановки остались проблемы:', file=sys.stderr)
        for problem in problems:
            print('  - ' + problem, file=sys.stderr)
        return 1
    if args.print_changed:
        for path in changed:
            print(path.relative_to(root))
    elif changed:
        print(f'версия {token}: обновлено файлов — {len(changed)}')
    else:
        print(f'версия {token}: изменения не нужны')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
