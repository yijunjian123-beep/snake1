export interface AudioController {
  unlock(): void;
  playUiPulse(): void;
  playRewardPulse(intensity?: number): void;
  destroy(): void;
}

export function createAudioController(): AudioController {
  let context: AudioContext | null = null;

  const getContext = (): AudioContext => {
    if (!context) {
      context = new AudioContext();
    }

    return context;
  };

  return {
    unlock(): void {
      const audioContext = getContext();

      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
    },

    playUiPulse(): void {
      const audioContext = getContext();
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(240, now);
      oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.08);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    },

    playRewardPulse(intensity = 1): void {
      const audioContext = getContext();
      const now = audioContext.currentTime;
      const master = audioContext.createGain();
      const low = audioContext.createOscillator();
      const high = audioContext.createOscillator();
      const clampedIntensity = Math.max(0.5, Math.min(18, intensity));

      low.type = "triangle";
      low.frequency.setValueAtTime(220 + clampedIntensity * 9, now);
      low.frequency.exponentialRampToValueAtTime(420 + clampedIntensity * 15, now + 0.1);

      high.type = "sine";
      high.frequency.setValueAtTime(440 + clampedIntensity * 18, now);
      high.frequency.exponentialRampToValueAtTime(920 + clampedIntensity * 24, now + 0.12);

      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(Math.min(0.14, 0.03 + clampedIntensity * 0.01), now + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

      low.connect(master);
      high.connect(master);
      master.connect(audioContext.destination);
      low.start(now);
      high.start(now);
      low.stop(now + 0.26);
      high.stop(now + 0.26);
    },

    destroy(): void {
      if (context && context.state !== "closed") {
        void context.close();
      }

      context = null;
    },
  };
}

