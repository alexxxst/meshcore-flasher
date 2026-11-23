import assert from 'node:assert/strict';
import test from 'node:test';

import { commandMatches, completeCommand, commandHint } from '../js/console-input.js';

test('commandMatches возвращает команды по префиксу', () => {
  assert.deepEqual(commandMatches('ver'), ['ver']);
  assert.ok(commandMatches('get ra').includes('get radio'));
  assert.deepEqual(commandMatches(''), []);
  assert.deepEqual(commandMatches('   '), []);
});

test('commandMatches не находит неизвестную команду', () => {
  assert.deepEqual(commandMatches('нет такой'), []);
});

test('completeCommand дополняет единственный вариант', () => {
  assert.equal(completeCommand('ver'), 'ver');
  assert.equal(completeCommand('boar'), 'board');
  assert.equal(completeCommand('get radio.'), 'get radio.rxgain');
});

test('completeCommand дополняет до общего префикса', () => {
  assert.equal(completeCommand('pow'), 'power');
  assert.equal(completeCommand('get ra'), 'get radio');
  // 'get radio' уже введено целиком — дополнять нечего
  assert.equal(completeCommand('get radio'), 'get radio');
});

test('completeCommand не трогает неизвестный текст', () => {
  assert.equal(completeCommand('xyz'), 'xyz');
  assert.equal(completeCommand(''), '');
});

test('commandHint показывает команду и описание для единственного варианта', () => {
  const hint = commandHint('ver');
  assert.match(hint, /^ver — /);
  assert.match(hint, /version/i);
  assert.equal(commandHint('xyz'), '');
});

test('commandHint перечисляет варианты для широкого префикса', () => {
  assert.equal(commandHint('get ra'), 'get radio — Get radio params (freq,bw,sf,cr) · ещё 1');
  const many = commandHint('set');
  assert.match(many, /^\d+ команд(а|ы)?: set /);
  assert.match(many, /…$/);
});
