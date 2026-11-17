import { biteRecipe, biteUrls } from './biteRecipe';

let context: AudioContext | null = null;

export function playTick(enabled: boolean, complete = false) {
  if (!enabled) return;
  try {
    context ??= new AudioContext();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(complete ? 440 : 310, now);
    oscillator.frequency.exponentialRampToValueAtTime(complete ? 660 : 390, now + 0.09);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
  } catch {
    // Sound is optional; ordering never depends on it.
  }
}


type BiteVoice = { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
const decodedBites = new Map<string, Promise<AudioBuffer | null>>();
const fadingBites = new Set<BiteVoice>();
let biteVoice: BiteVoice | null = null;
let biteGeneration = 0;

const biteProfiles: Record<string, { level: number; lowpass: number; rate: number }> = {
  satay: { level: 0.55, lowpass: 6500, rate: 1 },
  "pad-thai": { level: 0.39, lowpass: 6200, rate: 1 },
  "mango-rice": { level: 0.36, lowpass: 3600, rate: 1 },
  "tom-yum": { level: 0.32, lowpass: 6500, rate: 1 },
};

function biteContext() {
  context ??= new AudioContext({ latencyHint: "interactive" });
  return context;
}

function decodeBite(audio: AudioContext, url: string): Promise<AudioBuffer | null> {
  let pending = decodedBites.get(url);
  if (!pending) {
    pending = fetch(url).then(response => response.ok ? response.arrayBuffer() : Promise.reject())
      .then(bytes => audio.decodeAudioData(bytes)).catch(() => null);
    decodedBites.set(url, pending);
    void pending.then(buffer => { if (!buffer) decodedBites.delete(url); });
  }
  return pending;
}

export function primeBiteAudio(dishId: string) {
  try {
    const audio = biteContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    for (const url of biteUrls(dishId)) void decodeBite(audio, url);
  } catch { /* Optional sound must not block the menu. */ }
}

function releaseVoice(voice: BiteVoice) {
  if (biteVoice === voice) biteVoice = null;
  fadingBites.delete(voice);
  voice.source.disconnect(); voice.gain.disconnect(); voice.filter.disconnect();
}

export function stopBiteAudio() {
  biteGeneration++;
  const voices = [...fadingBites, ...(biteVoice ? [biteVoice] : [])];
  for (const voice of voices) {
    try { voice.source.stop(); } catch { /* The voice may already have finished. */ }
    releaseVoice(voice);
  }
}

export function playBiteAudio(enabled: boolean, dishId: string, bites: number) {
  if (!enabled) return;
  const recipe = biteRecipe(dishId, bites);
  if (!recipe) return;
  const generation = ++biteGeneration;
  void (async () => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let created: BiteVoice | undefined;
    try {
      const audio = biteContext(), started = performance.now();
      // Start device resume inside the actual click/key gesture, not after fetch.
      const resume = audio.state === "suspended" ? audio.resume() : Promise.resolve();
      const buffer = await Promise.race([
        Promise.all([resume, decodeBite(audio, recipe.url)]).then(([, value]) => value),
        new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 80); }),
      ]);
      if (!buffer || generation !== biteGeneration || document.hidden || audio.state !== "running" || performance.now() - started > 100) return;
      for (const fading of [...fadingBites]) { try { fading.source.stop(); } catch { /* Already stopped. */ } releaseVoice(fading); }
      if (biteVoice) {
        const previous = biteVoice, now = audio.currentTime;
        previous.gain.gain.cancelScheduledValues(now);
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
        previous.gain.gain.linearRampToValueAtTime(0, now + 0.045);
        previous.source.stop(now + 0.045); fadingBites.add(previous); biteVoice = null;
      }
      const profile = biteProfiles[dishId];
      const source = audio.createBufferSource(), gain = audio.createGain(), filter = audio.createBiquadFilter();
      created = { source, gain, filter }; const voice = created;
      source.buffer = buffer; source.playbackRate.value = profile.rate;
      // Texture and portion differences are already in the edited recordings.
      filter.type = "lowpass"; filter.frequency.value = profile.lowpass;
      const now = audio.currentTime, end = now + buffer.duration / source.playbackRate.value;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(profile.level, now + 0.012);
      gain.gain.setValueAtTime(profile.level, Math.max(now + 0.012, end - 0.06)); gain.gain.linearRampToValueAtTime(0, end);
      source.connect(filter).connect(gain).connect(audio.destination);
      source.addEventListener("ended", () => releaseVoice(voice), { once: true });
      biteVoice = voice; source.start(now); source.stop(end);
    } catch { if (created) { try { created.source.stop(); } catch { /* Never started. */ } releaseVoice(created); } }
    finally { if (deadline !== undefined) clearTimeout(deadline); }
  })();
}
