// Child process fixture: pause at the real Store fsync, after preparing the next
// revision but before replacing match.json. No timing assumptions about disk I/O.
import { open } from 'node:fs/promises';
import { Server } from 'node:http';

const probe = await open(new URL(import.meta.url), 'r');
const fileHandle = Object.getPrototypeOf(probe);
const sync = fileHandle.sync;
await probe.close();
let resume;
fileHandle.sync = async function () {
  const gate = new Promise((resolve) => { resume = resolve; });
  process.send('flushing');
  await gate;
  return sync.call(this);
};

const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send(this.address().port));
  this.on('request', (req) => process.send(req.url));
  return listen.apply(this, args);
};
process.on('message', (command) => {
  if (command === 'resume') resume();
  if (command === 'stop') {
    // On Windows ChildProcess.kill bypasses Node's SIGTERM handler.
    process.emit('SIGTERM', 'SIGTERM');
    process.send('stopping');
    setTimeout(() => process.send('held past connection timeout'), 2150);
  }
});
await import('../server.ts');
