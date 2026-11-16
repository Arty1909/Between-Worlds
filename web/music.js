"use strict";
// One continuous score, independent of video playback and dialogue rendering.
class WorldMusic {
  constructor(onError = () => {}) {
    this.onError = onError; this.context = null; this.master = null;
    this.track = null; this.current = null; this.pending = null;
    this.enabled = false; this.volume = .3; this.hidden = false;
    this.cache = new Map(); this.serial = 0;
  }
  async unlock() {
    if (!this.enabled || this.hidden) return;
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context(); this.master = this.context.createGain();
      this.master.gain.value = this.volume; this.master.connect(this.context.destination);
    }
    try { await this.context.resume(); await this.sync(); } catch (_) { /* another gesture can resume */ }
  }
  configure(track, enabled, volume) {
    this.track = track; this.enabled = !!enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, .15);
    if (this.context && this.enabled && !this.hidden) void this.sync();
  }
  async visibility(hidden) {
    this.hidden = hidden;
    if (!this.context) return;
    try {
      if (hidden) await this.context.suspend();
      else if (this.enabled) { await this.context.resume(); await this.sync(); }
    } catch (_) { /* browser may require a fresh user gesture */ }
  }
  async sync() {
    if (!this.context || !this.enabled || this.hidden || !this.track) return;
    if (this.current?.track === this.track || this.pending === this.track) return;
    const track = this.track, serial = ++this.serial;
    this.pending = track;
    try {
      let buffer = this.cache.get(track);
      if (!buffer) {
        const response = await fetch('assets/music/' + encodeURIComponent(track) + '.mp3?v=3.8');
        if (!response.ok) throw new Error('Missing music');
        buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        this.cache.set(track, buffer);
        if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
      }
      if (serial !== this.serial || track !== this.track || !this.enabled || this.hidden) return;
      const time = this.context.currentTime, source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer; source.loop = true; source.connect(gain); gain.connect(this.master);
      gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(1, time+1.5);
      source.start(time);
      const old = this.current;
      this.current = {track,source,gain};
      if (old) {
        if (old.gain.gain.cancelAndHoldAtTime) old.gain.gain.cancelAndHoldAtTime(time);
        else {old.gain.gain.cancelScheduledValues(time);old.gain.gain.setValueAtTime(old.gain.gain.value,time);}
        old.gain.gain.linearRampToValueAtTime(0,time+1.5); old.source.stop(time+1.55);
        old.source.onended=()=>{old.source.disconnect();old.gain.disconnect();};
      }
    } catch (_) {
      if (serial === this.serial && this.enabled) this.onError();
    } finally {
      if (serial === this.serial) this.pending = null;
    }
  }
}
window.WorldMusic = WorldMusic;
window.WORLD_TRACKS = {
  'room-v2':'Свет в твоём окне','0':'Изумрудный порог','2':'Тёплое сердце пламени',
  '3':'Лес, который помнит','4':'Песня речной долины','5':'Розы под землёй',
  '6':'На полях созвездий','7':'Тишина хрустального дворца','8':'Час, который не кончается',
  '9':'Шёпот забытых имён','10':'Отражённый лунный свет','11':'Между мирами'
};
