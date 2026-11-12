function delay(msecs) {
  return new Promise((resolve) => setTimeout(resolve, msecs));
}

class LineBreakTransformer {
  chunks = '';

  transform(chunk, controller) {
    this.chunks += chunk;
    const lines = this.chunks.split(/\r\n|\n|\r/);
    this.chunks = lines.pop();
    lines.forEach((line) => controller.enqueue(line + '\n'));
  }

  flush(controller) {
    if (this.chunks) controller.enqueue(this.chunks);
  }
}

export class SerialConsole {
  connected = false;

  constructor(port) {
    this.port = port;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.onOutput = (text) => {
      console.log(text);
    };
    this.onStatus = () => {};
  }

  async connect() {
    try {
      await this.port.open({ baudRate: 115200 });
    }
    catch (e) {
      this.connected = false;
      this.onStatus(false);
      this.addLine(`\n\n*** Не удалось открыть порт: ${e}`);
      throw e;
    }

    this.connected = true;
    this.onStatus(true);

    this.readLoop = this.port.readable
      .pipeThrough(new TextDecoderStream(), { signal: this.signal })
      .pipeThrough(new TransformStream(new LineBreakTransformer()))
      .pipeTo(new WritableStream({
        write: (chunk) => this.addLine(chunk),
      }))
      .then(() => {
        if (!this.signal.aborted) this.addLine('\n\n*** Соединение с портом потеряно');
      })
      .catch((e) => {
        if (!this.signal.aborted) this.addLine(`\n\n*** Соединение с портом потеряно: ${e}`);
      })
      .finally(() => {
        this.connected = false;
        this.onStatus(false);
      });
  }

  addLine(text) {
    this.onOutput(text);
  }

  async sendCommand(command) {
    if (!this.connected || !this.port.writable) {
      throw new Error('Порт не подключён');
    }

    const writer = this.port.writable.getWriter();
    try {
      // Прошивки MeshCore завершают строку по CR. При "\r\n" остаётся
      // пустая строка, и нода отвечает на неё "Unknown command".
      await writer.write(new TextEncoder().encode(command + '\r'));
    }
    finally {
      try {
        writer.releaseLock();
      }
      catch (err) {
        console.error('Ignoring release lock error', err);
      }
    }
  }

  async disconnect() {
    this.controller.abort();
    await delay(50);
    try {
      await this.port.close();
    }
    catch (e) {
      console.error('Ignoring port close error', e);
    }
    this.connected = false;
    this.onStatus(false);
  }

  async reset() {
    console.debug('Triggering reset');
    await this.port.setSignals({
      dataTerminalReady: false,
      requestToSend: true,
    });
    await delay(250);
    await this.port.setSignals({
      dataTerminalReady: false,
      requestToSend: false,
    });

    await delay(1250);
  }
}
