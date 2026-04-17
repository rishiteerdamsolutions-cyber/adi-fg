class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.isMuted = localStorage.getItem('asura_muted') === 'true';
    this.bgmOscs = [];
    this.currentBgmType = null;
    this.initialized = false;
    this._bgmInterval = null;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.bgmGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.masterGain.gain.value = this.isMuted ? 0 : 0.8;
      this.bgmGain.gain.value = 0.3; // BGM is lower volume
      
      this.initialized = true;
    } catch(e) {
      console.warn("Web Audio API not supported", e);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('asura_muted', this.isMuted);
    if (!this.initialized) this.init();
    
    if (this.ctx) {
      if (!this.isMuted && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  // --- Helpers ---
  playTone(freq, type, duration, vol, isBgm = false) {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    
    osc.connect(gain);
    gain.connect(isBgm ? this.bgmGain : this.sfxGain);
    
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + Math.min(0.05, duration/2));
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
    return { osc, gain };
  }

  playNoise(duration, vol) {
    if (!this.ctx || this.isMuted) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    
    const gain = this.ctx.createGain();
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    
    noise.start();
  }

  vibrate(ms) {
    if (navigator.vibrate && !this.isMuted) {
      navigator.vibrate(ms);
    }
  }

  // --- Background Music ---
  stopBgm() {
    if (this._bgmInterval) { clearInterval(this._bgmInterval); this._bgmInterval = null; }
    this.bgmOscs.forEach(o => {
      try {
        o.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
        o.osc.stop(this.ctx.currentTime + 0.5);
      } catch(e) {}
    });
    this.bgmOscs = [];
    this.currentBgmType = null;
  }

  playLobbyBgm() {
    if (!this.ctx) this.init();
    if (!this.ctx || this.isMuted || this.currentBgmType === 'lobby') return;
    this.stopBgm();
    this.currentBgmType = 'lobby';
    
    // Joyful, soft simple sequence loop
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C E G C
    let step = 0;
    this._bgmInterval = setInterval(() => {
      if (this.isMuted) return;
      this.playTone(notes[step], 'sine', 1.0, 0.1, true);
      step = (step + 1) % notes.length;
    }, 2000); // Very slow, peaceful chime every 2 seconds
  }

  playBattleBgm() {
    if (!this.ctx) this.init();
    if (!this.ctx || this.isMuted || this.currentBgmType === 'battle') return;
    this.stopBgm();
    this.currentBgmType = 'battle';
    
    // Soft rhythmic repeating bell sound instead of harsh pulse
    const notes = [220, 220, 329.63, 220]; // Rhythm
    let step = 0;
    this._bgmInterval = setInterval(() => {
      if (this.isMuted) return;
      this.playTone(notes[step], 'triangle', 0.2, 0.15, true);
      step = (step + 1) % notes.length;
    }, 500); // 120 bpm rhythm
  }

  // --- Weapon Sounds ---
  playWeapon(weaponNo, isEnemy = false) {
    if (!this.ctx || this.isMuted) return;
    const vol = isEnemy ? 0.3 : 1.0;
    const t = this.ctx.currentTime;

    switch(weaponNo) {
      case 1: // Staff: whoosh
        this.playTone(300, 'sine', 0.2, vol);
        this.playNoise(0.2, vol*0.5);
        break;
      case 2: // Crossbow: twang
        this.playTone(800, 'triangle', 0.1, vol);
        this.playTone(1200, 'square', 0.05, vol*0.5);
        break;
      case 3: // War Hammer: deep thud
        this.playTone(100, 'square', 0.3, vol);
        this.playNoise(0.1, vol);
        break;
      case 4: // Sword: metallic slash
        {
          const o = this.playTone(1500, 'square', 0.15, vol*0.6);
          if (o) o.osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
        }
        break;
      case 5: // Gun: crack
        this.playNoise(0.1, vol*2);
        this.playTone(200, 'square', 0.05, vol*1.5);
        break;
      case 6: // Bow: release
        {
          const o = this.playTone(600, 'triangle', 0.2, vol);
          if (o) o.osc.frequency.linearRampToValueAtTime(400, t + 0.2);
        }
        break;
      case 7: // Slingshot: snap
        this.playTone(1000, 'sine', 0.1, vol);
        this.playTone(1500, 'sawtooth', 0.1, vol*0.5);
        break;
      case 8: // Battle Axe: heavy cleave
        this.playTone(200, 'sawtooth', 0.25, vol);
        this.playNoise(0.2, vol*0.8);
        break;
      case 9: // Spear: whistle
        {
          const o = this.playTone(1200, 'sine', 0.25, vol);
          if (o) o.osc.frequency.linearRampToValueAtTime(2000, t + 0.25);
        }
        break;
      case 10: // Trident: shimmer
        this.playTone(2000, 'sawtooth', 0.2, vol);
        this.playTone(2050, 'sawtooth', 0.2, vol);
        break;
      default:
        this.playTone(500, 'sine', 0.1, vol);
    }
  }

  // --- Impact & Damage Sounds ---
  playHitOpponent() {
    this.playTone(200, 'square', 0.1, 0.6);
    this.playNoise(0.1, 0.4);
  }

  playTakeDamage() {
    this.playTone(150, 'sawtooth', 0.2, 1.0);
    this.playNoise(0.2, 0.8);
    this.vibrate(200);
  }

  playCollision() {
    this.playTone(1000, 'triangle', 0.1, 0.5);
  }

  playLowHpWarning() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const o = this.playTone(100, 'sine', 0.4, 0.8);
    if (o) {
      o.gain.gain.setValueAtTime(0.8, t);
      o.gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      o.gain.gain.setValueAtTime(0.5, t + 0.2);
      o.gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    }
  }

  // --- Power Move Sounds ---
  playDoubleShot() {
    this.playTone(600, 'sine', 0.1, 0.8);
    setTimeout(() => this.playTone(800, 'sine', 0.15, 0.8), 100);
  }

  playPowerMove() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const o1 = this.playTone(400, 'sawtooth', 0.8, 0.5);
    if (o1) o1.osc.frequency.exponentialRampToValueAtTime(1200, t + 0.4);
    
    setTimeout(() => {
      this.playNoise(0.4, 1.0);
      this.playTone(100, 'square', 0.5, 1.5);
      this.vibrate([100, 50, 200]);
    }, 400);
  }

  // --- UI & Game State ---
  playClick() {
    this.playTone(800, 'sine', 0.05, 0.3);
  }

  playJoin() {
    // Beautiful harp-like glissando
    [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
      setTimeout(() => this.playTone(f, 'sine', 0.8, 0.4), i * 100);
    });
  }

  playStomp() {
    this.playTone(80, 'square', 0.3, 1.2);
    this.playNoise(0.3, 0.8);
    this.vibrate(100);
  }

  playCountdownTick() {
    this.playTone(1000, 'sine', 0.05, 0.4);
  }

  playGameStart() {
    this.playTone(400, 'sawtooth', 0.6, 0.7);
    this.playTone(600, 'sawtooth', 0.6, 0.7);
  }

  playVictory() {
    this.stopBgm();
    // Simple fanfare
    [523.25, 523.25, 523.25, 659.25, 783.99].forEach((f, i) => {
      setTimeout(() => this.playTone(f, 'square', (i==4)?0.6:0.15, 0.6), i * 150);
    });
  }

  playDefeat() {
    this.stopBgm();
    this.playTone(300, 'sawtooth', 0.4, 0.8);
    setTimeout(() => this.playTone(250, 'sawtooth', 0.6, 0.8), 300);
  }

  playReactionWord(word) {
    if (!word || this.isMuted) return;
    try {
      if (window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined') {
        const u = new SpeechSynthesisUtterance(String(word));
        u.rate = 1.05;
        u.pitch = 1.0;
        u.volume = 0.6;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        return;
      }
    } catch (e) {
      // Fall through to subtle fallback chirp.
    }
    this.playTone(920, 'sine', 0.12, 0.2);
  }
}

const sfx = new SoundEngine();
