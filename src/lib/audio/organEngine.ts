import { OrganType } from '@/src/types/chant';
import { ChantTimeline } from './chantTimeline';

export interface OrganProfile {
  id: OrganType;
  label: string;
  subtitle: string;
  reverbSeconds: number;
  reverbDecay: number;
  reverbWet: number;
  attackSec: number;
  releaseSec: number;
  masterGain: number;
}

export const ORGAN_PROFILES: Record<OrganType, OrganProfile> = {
  flute: {
    id: 'flute',
    label: 'Flute Organ',
    subtitle: "8' Rohrflöte · 4' Harmonic Flute · 2' Piccolo",
    reverbSeconds: 1.5,
    reverbDecay: 2.8,
    reverbWet: 0.28,
    attackSec: 0.032,
    releaseSec: 0.11,
    masterGain: 0.52,
  },
  pipe: {
    id: 'pipe',
    label: 'Pipe Organ',
    subtitle: "16' Bourdon · 8' Open Diapason · 4' Principal · Nasard",
    reverbSeconds: 3.1,
    reverbDecay: 2.3,
    reverbWet: 0.44,
    attackSec: 0.045,
    releaseSec: 0.16,
    masterGain: 0.46,
  },
  wind: {
    id: 'wind',
    label: 'Wind Organ',
    subtitle: "8' Aeoline · Bellows Free Reed · Chapel Swell",
    reverbSeconds: 1.6,
    reverbDecay: 2.7,
    reverbWet: 0.26,
    attackSec: 0.058,
    releaseSec: 0.11,
    masterGain: 0.48,
  },
};

function createSeededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildReverbBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  decay: number
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  const rand = createSeededRandom(4217);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      const white = rand() * 2 - 1;
      // Warm stone lowpass damping on reflections
      lp = lp * 0.65 + white * 0.35;
      data[i] = lp * env;
    }
  }
  return impulse;
}

function createNoiseBuffer(ctx: BaseAudioContext, durationSec = 0.05): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = createSeededRandom(913);
  for (let i = 0; i < length; i++) {
    data[i] = (rand() * 2 - 1) * Math.exp(-i / (length * 0.28));
  }
  return buf;
}

const reverbBufferCache = new WeakMap<
  BaseAudioContext,
  Partial<Record<OrganType, AudioBuffer>>
>();
const noiseBufferCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function getCachedReverbBuffer(ctx: BaseAudioContext, organ: OrganType): AudioBuffer {
  let byOrgan = reverbBufferCache.get(ctx);
  if (!byOrgan) {
    byOrgan = {};
    reverbBufferCache.set(ctx, byOrgan);
  }
  const existing = byOrgan[organ];
  if (existing) return existing;

  const profile = ORGAN_PROFILES[organ];
  const created = buildReverbBuffer(ctx, profile.reverbSeconds, profile.reverbDecay);
  byOrgan[organ] = created;
  return created;
}

function getCachedNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const existing = noiseBufferCache.get(ctx);
  if (existing) return existing;
  const created = createNoiseBuffer(ctx, 0.045);
  noiseBufferCache.set(ctx, created);
  return created;
}

interface TrackedSource {
  node: AudioScheduledSourceNode;
  startTime: number;
}

interface OrganBus {
  input: GainNode;
  masterGain: GainNode;
  noiseBuffer: AudioBuffer;
  sources: TrackedSource[];
}

function buildOrganBus(ctx: BaseAudioContext, organ: OrganType, volume = 1.0): OrganBus {
  const profile = ORGAN_PROFILES[organ];
  const input = ctx.createGain();
  input.gain.value = profile.masterGain;

  const masterGain = ctx.createGain();
  masterGain.gain.value = Math.max(0, Math.min(1, volume));

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.15;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - profile.reverbWet * 0.45;

  const wetGain = ctx.createGain();
  wetGain.gain.value = profile.reverbWet;

  const convolver = ctx.createConvolver();
  convolver.buffer = getCachedReverbBuffer(ctx, organ);

  input.connect(dryGain);
  input.connect(convolver);
  convolver.connect(wetGain);

  dryGain.connect(compressor);
  wetGain.connect(compressor);
  compressor.connect(masterGain);
  masterGain.connect(ctx.destination);

  return {
    input,
    masterGain,
    noiseBuffer: getCachedNoiseBuffer(ctx),
    sources: [],
  };
}

function teardownOrganBus(ctx: AudioContext, bus: OrganBus, fadeSec = 0.04) {
  const now = ctx.currentTime;
  const safeFade = Math.max(0.015, fadeSec);
  const stopAt = now + safeFade + 0.01;

  try {
    bus.input.gain.cancelScheduledValues(now);
    bus.input.gain.setValueAtTime(bus.input.gain.value, now);
    bus.input.gain.linearRampToValueAtTime(0.0001, now + Math.min(0.025, safeFade * 0.65));

    bus.masterGain.gain.cancelScheduledValues(now);
    bus.masterGain.gain.setValueAtTime(bus.masterGain.gain.value, now);
    bus.masterGain.gain.linearRampToValueAtTime(0.0001, now + safeFade);
  } catch {
    // ignore audio param automation errors
  }

  for (const { node, startTime } of bus.sources) {
    try {
      if (startTime > stopAt) {
        node.disconnect();
        node.stop(startTime + 0.001);
      } else {
        node.stop(stopAt);
      }
    } catch {
      try {
        node.disconnect();
      } catch {
        // ignore already stopped/disconnected source
      }
    }
  }
  bus.sources.length = 0;

  window.setTimeout(() => {
    try {
      bus.input.disconnect();
      bus.masterGain.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }, Math.ceil((safeFade + 0.06) * 1000));
}

function scheduleOrganNote(
  ctx: BaseAudioContext,
  bus: OrganBus,
  organ: OrganType,
  freq: number,
  startTime: number,
  durationSec: number,
  gainScale = 1
) {
  const profile = ORGAN_PROFILES[organ];
  const voiceGain = ctx.createGain();
  const peak = 0.32 * gainScale;
  const safeDuration = Math.max(0.018, durationSec);
  const effectiveAttack = Math.min(profile.attackSec, Math.max(0.006, safeDuration * 0.45));
  const attackEnd = startTime + effectiveAttack;
  const noteEnd = startTime + safeDuration;
  const sustainEnd = Math.max(attackEnd + 0.002, noteEnd - Math.min(0.01, safeDuration * 0.2));
  const releaseEnd = Math.max(sustainEnd + 0.015, noteEnd + profile.releaseSec);

  voiceGain.gain.setValueAtTime(0.0001, startTime);
  voiceGain.gain.linearRampToValueAtTime(peak, attackEnd);
  voiceGain.gain.setValueAtTime(peak * 0.94, sustainEnd);
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';

  if (organ === 'flute') {
    toneFilter.frequency.setValueAtTime(Math.min(3400, freq * 5.2), startTime);
    toneFilter.Q.value = 0.6;

    // 8' Rohrflöte + 4' Harmonic Flute + 2' Piccolo
    const ranks = [
      { mult: 1, detune: 0, amp: 0.78, type: 'sine' as OscillatorType },
      { mult: 2, detune: 1.2, amp: 0.36, type: 'triangle' as OscillatorType },
      { mult: 4, detune: -0.8, amp: 0.1, type: 'sine' as OscillatorType },
    ];

    for (const r of ranks) {
      const osc = ctx.createOscillator();
      const rg = ctx.createGain();
      osc.type = r.type;
      osc.frequency.setValueAtTime(freq * r.mult, startTime);
      osc.detune.setValueAtTime(r.detune, startTime);
      rg.gain.value = r.amp;
      osc.connect(rg);
      rg.connect(toneFilter);
      osc.start(startTime);
      osc.stop(releaseEnd + 0.02);
      bus.sources.push({ node: osc, startTime });
    }

    // Gentle wooden flute breath chiff transient
    const chiff = ctx.createBufferSource();
    chiff.buffer = bus.noiseBuffer;
    const chiffBp = ctx.createBiquadFilter();
    chiffBp.type = 'bandpass';
    chiffBp.frequency.value = Math.min(2800, freq * 2.4);
    chiffBp.Q.value = 3.2;
    const chiffGain = ctx.createGain();
    chiffGain.gain.value = 0.14 * gainScale;
    chiff.connect(chiffBp);
    chiffBp.connect(chiffGain);
    chiffGain.connect(bus.input);
    chiff.start(startTime);
    bus.sources.push({ node: chiff, startTime });
  } else if (organ === 'pipe') {
    toneFilter.frequency.setValueAtTime(Math.min(4600, freq * 7.2), startTime);
    toneFilter.Q.value = 0.8;

    // 16' Bourdon + dual 8' Open Diapason + 4' Principal + 2 2/3' Nasard
    const ranks = [
      { mult: 0.5, detune: 0, amp: 0.28, type: 'sine' as OscillatorType },
      { mult: 1, detune: -2.5, amp: 0.58, type: 'triangle' as OscillatorType },
      { mult: 1, detune: 2.5, amp: 0.54, type: 'sawtooth' as OscillatorType },
      { mult: 2, detune: 1.2, amp: 0.34, type: 'sine' as OscillatorType },
      { mult: 3, detune: -1.5, amp: 0.16, type: 'sine' as OscillatorType },
      { mult: 4, detune: 2.2, amp: 0.12, type: 'sine' as OscillatorType },
    ];

    for (const r of ranks) {
      const osc = ctx.createOscillator();
      const rg = ctx.createGain();
      osc.type = r.type;
      osc.frequency.setValueAtTime(freq * r.mult, startTime);
      osc.detune.setValueAtTime(r.detune, startTime);
      rg.gain.value = r.amp;
      osc.connect(rg);
      rg.connect(toneFilter);
      osc.start(startTime);
      osc.stop(releaseEnd + 0.02);
      bus.sources.push({ node: osc, startTime });
    }
  } else {
    // Wind Organ (Bellows Free-Reed & Aeoline Chorus)
    toneFilter.frequency.setValueAtTime(Math.min(2800, freq * 5.4), startTime);
    toneFilter.Q.value = 1.3;

    const nasalPeak = ctx.createBiquadFilter();
    nasalPeak.type = 'peaking';
    nasalPeak.frequency.value = 720;
    nasalPeak.Q.value = 1.7;
    nasalPeak.gain.value = 4.2;

    const ranks = [
      { mult: 1, detune: -3.6, amp: 0.55, type: 'sawtooth' as OscillatorType },
      { mult: 1, detune: 3.8, amp: 0.45, type: 'square' as OscillatorType },
      { mult: 2, detune: 1.4, amp: 0.22, type: 'triangle' as OscillatorType },
    ];

    for (const r of ranks) {
      const osc = ctx.createOscillator();
      const rg = ctx.createGain();
      osc.type = r.type;
      osc.frequency.setValueAtTime(freq * r.mult, startTime);
      osc.detune.setValueAtTime(r.detune, startTime);
      rg.gain.value = r.amp;
      osc.connect(rg);
      rg.connect(nasalPeak);
      osc.start(startTime);
      osc.stop(releaseEnd + 0.02);
      bus.sources.push({ node: osc, startTime });
    }

    // Subtle bellows wind air rush
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = bus.noiseBuffer;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 1400;
    windBp.Q.value = 1.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.08 * gainScale;
    windNoise.connect(windBp);
    windBp.connect(windGain);
    windGain.connect(bus.input);
    windNoise.start(startTime);
    bus.sources.push({ node: windNoise, startTime });

    nasalPeak.connect(toneFilter);
  }

  toneFilter.connect(voiceGain);
  voiceGain.connect(bus.input);
}

export interface PlayTimelineOptions {
  fadePrevSec?: number;
  lookaheadSec?: number;
}

const SCHEDULER_WINDOW_SEC = 1.25;
const SCHEDULER_POLL_MS = 120;

export class LiveOrganPlayer {
  private ctx: AudioContext | null = null;
  private playbackBus: OrganBus | null = null;
  private auditionBus: OrganBus | null = null;
  private auditionBusOrgan: OrganType | null = null;
  private rafId: number | null = null;
  private schedulerTimer: number | null = null;
  private stopTimer: number | null = null;
  private isPlaying = false;
  private volume = 0.85;
  private playbackGeneration = 0;
  private activeTimeline: ChantTimeline | null = null;
  private playbackClampedOffset = 0;
  private playbackStartAudioTime = 0;

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx) {
      for (const bus of [this.playbackBus, this.auditionBus]) {
        if (!bus) continue;
        try {
          bus.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
        } catch {
          // ignore gain update errors
        }
      }
    }
  }

  public getElapsedSec(): number | null {
    if (!this.isPlaying || !this.ctx || !this.activeTimeline) {
      return null;
    }
    const raw =
      this.playbackClampedOffset +
      Math.max(0, this.ctx.currentTime - this.playbackStartAudioTime);
    return Math.min(
      this.activeTimeline.totalDurationSec,
      Math.max(this.playbackClampedOffset, raw)
    );
  }

  private ensureAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private ensureAuditionBus(organ: OrganType): { ctx: AudioContext; bus: OrganBus } {
    const ctx = this.ensureAudioContext();
    if (!this.auditionBus || this.auditionBusOrgan !== organ) {
      if (this.auditionBus) {
        teardownOrganBus(ctx, this.auditionBus, 0.06);
      }
      this.auditionBus = buildOrganBus(ctx, organ, this.volume);
      this.auditionBusOrgan = organ;
    }
    return { ctx, bus: this.auditionBus };
  }

  public auditionNote(freq: number, organ: OrganType, durationSec = 0.42) {
    const { ctx, bus } = this.ensureAuditionBus(organ);
    const now = ctx.currentTime + 0.01;
    // Prune completed sources from audition bus
    if (bus.sources.length > 64) {
      bus.sources = bus.sources.filter((s) => s.startTime + 2 > ctx.currentTime);
    }
    scheduleOrganNote(ctx, bus, organ, freq, now, durationSec, 0.85);
  }

  private cleanupTimers() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  public playTimeline(
    timeline: ChantTimeline,
    organ: OrganType,
    onProgress: (activeNoteId: string | null, elapsedSec: number) => void,
    onComplete: () => void,
    startOffsetSec = 0,
    options?: PlayTimelineOptions
  ) {
    this.stop(options?.fadePrevSec ?? 0.08);
    if (timeline.events.length === 0) {
      onProgress(null, 0);
      onComplete();
      return;
    }

    const gen = ++this.playbackGeneration;
    const ctx = this.ensureAudioContext();
    const bus = buildOrganBus(ctx, organ, this.volume);
    this.playbackBus = bus;
    this.isPlaying = true;
    this.activeTimeline = timeline;

    const clampedOffset = Math.max(0, Math.min(timeline.totalDurationSec, startOffsetSec));
    const lookahead = options?.lookaheadSec ?? 0.035;
    const startAudioTime = ctx.currentTime + lookahead;
    this.playbackClampedOffset = clampedOffset;
    this.playbackStartAudioTime = startAudioTime;

    let nextEventIdx = 0;
    while (
      nextEventIdx < timeline.events.length &&
      timeline.events[nextEventIdx].startSec + timeline.events[nextEventIdx].durationSec <= clampedOffset
    ) {
      nextEventIdx += 1;
    }

    const pumpScheduleWindow = () => {
      if (!this.isPlaying || !this.ctx || this.playbackGeneration !== gen) return;
      const elapsedNow = Math.max(
        clampedOffset,
        clampedOffset + (this.ctx.currentTime - startAudioTime)
      );
      const windowEnd = elapsedNow + SCHEDULER_WINDOW_SEC;

      // Prune finished source references to keep bus.sources tiny on long scores
      if (bus.sources.length > 96) {
        const cutoff = this.ctx.currentTime - 2.0;
        bus.sources = bus.sources.filter((s) => s.startTime > cutoff);
      }

      while (nextEventIdx < timeline.events.length) {
        const ev = timeline.events[nextEventIdx];
        if (ev.startSec > windowEnd) break;
        nextEventIdx += 1;

        const evEnd = ev.startSec + ev.durationSec;
        if (evEnd <= clampedOffset) continue;
        const relStart = Math.max(0, ev.startSec - clampedOffset);
        const trimmedDur =
          ev.startSec < clampedOffset ? evEnd - clampedOffset : ev.durationSec;
        if (trimmedDur <= 0.012) continue;

        scheduleOrganNote(
          this.ctx,
          bus,
          organ,
          ev.frequency,
          startAudioTime + relStart,
          trimmedDur + ev.legatoTailSec,
          1.0
        );
      }
    };

    pumpScheduleWindow();
    this.schedulerTimer = window.setInterval(pumpScheduleWindow, SCHEDULER_POLL_MS);

    const remainingDuration = Math.max(0.2, timeline.totalDurationSec - clampedOffset);

    const tick = () => {
      if (!this.isPlaying || !this.ctx || this.playbackGeneration !== gen) return;
      const rawElapsed = clampedOffset + (this.ctx.currentTime - startAudioTime);
      const elapsed = Math.max(clampedOffset, rawElapsed);
      let activeId: string | null = null;
      for (let i = 0; i < timeline.events.length; i++) {
        const ev = timeline.events[i];
        const endSec = ev.startSec + ev.durationSec;
        if (
          elapsed >= ev.startSec &&
          (elapsed < endSec || (i === timeline.events.length - 1 && elapsed <= endSec))
        ) {
          activeId = ev.noteId;
          break;
        }
      }
      onProgress(activeId, Math.min(timeline.totalDurationSec, elapsed));
      if (elapsed < timeline.totalDurationSec + 0.15) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.cleanupTimers();
        this.isPlaying = false;
        this.activeTimeline = null;
        onProgress(null, 0);
        onComplete();
      }
    };

    this.rafId = requestAnimationFrame(tick);
    this.stopTimer = window.setTimeout(() => {
      if (this.isPlaying && this.playbackGeneration === gen) {
        this.cleanupTimers();
        this.isPlaying = false;
        this.activeTimeline = null;
        onProgress(null, 0);
        onComplete();
      }
    }, (remainingDuration + lookahead + 0.4) * 1000);
  }

  public stop(fadeSec = 0.1) {
    this.playbackGeneration += 1;
    this.isPlaying = false;
    this.activeTimeline = null;
    this.cleanupTimers();
    if (this.playbackBus && this.ctx) {
      const busToStop = this.playbackBus;
      this.playbackBus = null;
      teardownOrganBus(this.ctx, busToStop, fadeSec);
    }
  }
}

export async function renderTimelineOffline(
  timeline: ChantTimeline,
  organ: OrganType,
  sampleRate = 44100
): Promise<AudioBuffer> {
  const profile = ORGAN_PROFILES[organ];
  const tailSec = profile.reverbSeconds + 0.4;
  const totalSec = Math.max(1.0, timeline.totalDurationSec + tailSec);
  const offline = new OfflineAudioContext(2, Math.ceil(totalSec * sampleRate), sampleRate);
  const bus = buildOrganBus(offline, organ);

  const startOffset = 0.05;
  for (const ev of timeline.events) {
    scheduleOrganNote(
      offline,
      bus,
      organ,
      ev.frequency,
      startOffset + ev.startSec,
      ev.durationSec + ev.legatoTailSec,
      1.0
    );
  }

  return offline.startRendering();
}
