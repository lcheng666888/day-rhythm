import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../player.mjs';
class AudioStub {
  constructor() {this.listeners = {}; this.volume = 1; this.currentTime = 0; this.paused = true; this.requests = [];}
  addEventListener(name, cb) {(this.listeners[name] ??= []).push(cb);}
  emit(name) {for (const cb of this.listeners[name] || []) cb();}
  pause() {this.paused = true; this.emit('pause');}
  load() {}
  play() {return new Promise((resolve, reject) => this.requests.push({resolve: () => {this.paused = false; resolve();}, reject}));}
}
test('rapid switching ignores stale play completion and keeps one active scene', async () => {
  const audio = new AudioStub(); const player = new Player(audio);
  const a = player.play('morning', 'preview', 65);
  const b = player.play('nap', 'preview', 50);
  audio.requests[1].resolve(); await b;
  audio.requests[0].resolve(); await a;
  assert.equal(player.current.id, 'nap');
  assert.equal(player.current.status, 'playing');
  player.stop(); assert.equal(player.current, null); assert.equal(audio.paused, true);
});
test('stop while play is pending cannot revive animation', async () => {
  const audio = new AudioStub(); const player = new Player(audio);
  const a = player.play('morning', 'preview', 65);
  player.stop(); audio.requests[0].resolve(); await a;
  assert.equal(player.current, null); assert.equal(audio.paused, true);
});
test('autoplay rejection produces blocked state, not a playing animation', async () => {
  const audio = new AudioStub(); const player = new Player(audio);
  const a = player.play('night', 'alert', 40);
  audio.requests[0].reject(new Error('NotAllowedError')); await a;
  assert.equal(player.current.status, 'blocked'); player.stop();
});
test('volume is live, previews finish, alerts stop at a bounded duration', async () => {
  const audio = new AudioStub(); const player = new Player(audio);
  const a = player.play('nap', 'preview', 60); audio.requests[0].resolve(); await a;
  player.setVolume(20); assert.equal(audio.volume, .2);
  audio.emit('ended'); assert.equal(player.current, null);
  const b = player.play('night', 'alert', 40); audio.requests[1].resolve(); await b;
  player.checkDeadline(Date.now() + 41_000); assert.equal(player.current, null);
});
