const paths = {morning: 'assets/morning.wav', nap: 'assets/nap.wav', night: 'assets/night.wav', unlock: 'assets/silence.wav'};
const limits = {morning: 90_000, nap: 45_000, night: 40_000};
export class Player {
  constructor(audio, onChange = () => {}, onFinish = () => {}) {
    this.audio = audio; this.onChange = onChange; this.onFinish = onFinish; this.current = null; this.token = 0;
    audio.addEventListener('ended', () => {if (this.current && !audio.loop) this.stop('ended');});
    audio.addEventListener('pause', () => {if (this.current?.status === 'playing') {this.current.status = 'paused'; this.onChange(this.current);}});
    audio.addEventListener('playing', () => {if (this.current) {this.current.status = 'playing'; this.onChange(this.current);}});
    audio.addEventListener('waiting', () => {if (this.current) {this.current.status = 'loading'; this.onChange(this.current);}});
    audio.addEventListener('error', () => {if (this.current) {this.current.status = 'blocked'; this.onChange(this.current);}});
  }
  async play(id, mode, volume) {
    this.stop('switch');
    const token = ++this.token;
    this.current = {id, mode, status: 'loading', until: mode === 'alert' ? Date.now() + limits[id] : null};
    this.audio.src = paths[id]; this.audio.loop = mode === 'alert'; this.setVolume(volume); this.audio.load();
    this.onChange(this.current);
    try {
      await this.audio.play();
      if (this.token !== token) {if (!this.current) this.audio.pause(); return false;}
      this.current.status = 'playing'; this.onChange(this.current); return true;
    } catch {
      if (this.token === token && this.current) {this.current.status = 'blocked'; this.onChange(this.current);}
      return false;
    }
  }
  setVolume(value) {this.audio.volume = Math.max(0, Math.min(1, value / 100));}
  stop(reason = 'user') {
    const previous = this.current; this.current = null; ++this.token;
    this.audio.pause(); try {this.audio.currentTime = 0;} catch {}
    this.audio.loop = false; this.onChange(null);
    if (previous) this.onFinish(previous, reason);
  }
  checkDeadline(now) {if (this.current?.until && now >= this.current.until) this.stop('timeout');}
}
