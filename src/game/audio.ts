export interface AudioController {
  unlock(): void;
  playUiPulse(): void;
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

    destroy(): void {
      if (context && context.state !== "closed") {
        void context.close();
      }

      context = null;
    },
  };
}

