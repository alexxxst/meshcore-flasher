// Подсказки и дополнение команд консоли.
// Чистые функции без DOM — их проверяет tests/console-input.test.mjs.
import { commandReference } from './commands.js?v=b1029fa972';

const commandNames = Object.keys(commandReference);

// Все команды, начинающиеся с введённого текста.
export function commandMatches(text) {
  const value = text ?? '';
  if (!value.trim()) return [];
  return commandNames.filter((name) => name.startsWith(value));
}

// Tab: дополняет до единственной команды или до общего префикса вариантов.
export function completeCommand(text) {
  const matches = commandMatches(text);
  if (!matches.length) return text;
  if (matches.length === 1) return matches[0];

  let prefix = matches[0];
  for (const name of matches.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1;
    prefix = prefix.slice(0, i);
  }

  // Если общий префикс не длиннее введённого, дополнять нечего.
  return prefix.length > (text ?? '').length ? prefix : text;
}

// Одна строка под вводом: описание лучшей команды, несколько вариантов
// для короткого префикса или список совпадений, когда их много.
export function commandHint(text) {
  const matches = commandMatches(text);
  if (!matches.length) return '';

  const best = [...matches].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  const name = best.trimEnd();
  const description = commandReference[best] ?? '';

  if (matches.length <= 3 && description) {
    const extra = matches.length > 1 ? ` · ещё ${matches.length - 1}` : '';
    return `${name} — ${description}${extra}`;
  }

  const names = [...matches]
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, 3)
    .map((command) => command.trimEnd());
  const tail = matches.length > names.length ? ' …' : '';
  return `${matches.length} ${plural(matches.length, 'команда', 'команды', 'команд')}: ${names.join(' · ')}${tail}`;
}

function plural(count, one, few, many) {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}
