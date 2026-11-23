import assert from 'node:assert/strict';
import test from 'node:test';

import { SerialConsole } from '../lib/console.js';

// Фейковый порт: подключение, чтение, запись и закрытие без железа.
function fakePort() {
  let controller;
  const readable = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  const written = [];
  const writable = new WritableStream({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk));
    },
  });

  return {
    port: {
      open: async () => {},
      close: async () => {},
      setSignals: async () => {},
      readable,
      writable,
    },
    written,
    push(text) {
      controller.enqueue(new TextEncoder().encode(text));
    },
  };
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test('connect открывает порт и сообщает статус', async () => {
  const { port } = fakePort();
  const console_ = new SerialConsole(port);
  const statuses = [];
  console_.onStatus = (connected) => statuses.push(connected);

  await console_.connect();

  assert.equal(console_.connected, true);
  assert.deepEqual(statuses, [true]);
  await console_.disconnect();
});

test('sendCommand завершает строку одним CR, без LF', async () => {
  // Прошивки MeshCore режут строку по CR: при "\r\n" остаётся пустая
  // строка, и нода отвечает на неё "Unknown command".
  const { port, written } = fakePort();
  const console_ = new SerialConsole(port);
  console_.onOutput = () => {};
  await console_.connect();

  await console_.sendCommand('ver');
  await console_.sendCommand('board');

  assert.deepEqual(written, ['ver\r', 'board\r']);
  await console_.disconnect();
});

test('чтение порта отдаёт строки в onOutput', async () => {
  const { port, push } = fakePort();
  const console_ = new SerialConsole(port);
  const lines = [];
  console_.onOutput = (text) => lines.push(text);
  await console_.connect();

  push('  -> v1.18-meshcore.spb.ru-99089b6d\r\n');
  push('second line\r\n');
  await tick();

  assert.deepEqual(lines, ['  -> v1.18-meshcore.spb.ru-99089b6d\n', 'second line\n']);
  await console_.disconnect();
});

test('CR и LF приходят разными кусками — без лишней пустой строки', async () => {
  const { port, push } = fakePort();
  const console_ = new SerialConsole(port);
  const lines = [];
  console_.onOutput = (text) => lines.push(text);
  await console_.connect();

  // прошивка печатает эхо команды, затем '\r' и отдельно '\n'
  push('ver\r');
  await tick();
  push('\n  -> Unknown command\r\n');
  await tick();

  assert.deepEqual(lines, ['ver\n', '  -> Unknown command\n']);
  await console_.disconnect();
});

test('одиночные CR внутри вывода остаются переводами строк', async () => {
  const { port, push } = fakePort();
  const console_ = new SerialConsole(port);
  const lines = [];
  console_.onOutput = (text) => lines.push(text);
  await console_.connect();

  push('one\rtwo\rthree\n');
  await tick();

  assert.deepEqual(lines, ['one\n', 'two\n', 'three\n']);
  await console_.disconnect();
});

test('sendCommand без подключения бросает понятную ошибку', async () => {
  const { port } = fakePort();
  const console_ = new SerialConsole(port);

  await assert.rejects(() => console_.sendCommand('ver'), /Порт не подключён/);
});

test('disconnect сбрасывает connected и статус', async () => {
  const { port } = fakePort();
  const console_ = new SerialConsole(port);
  const statuses = [];
  console_.onStatus = (connected) => statuses.push(connected);
  await console_.connect();

  await console_.disconnect();

  assert.equal(console_.connected, false);
  assert.equal(statuses.at(-1), false);
});
