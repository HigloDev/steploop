"""Original five-note pentatonic bell, rendered locally without external audio."""
import math
import struct
import wave
from pathlib import Path

RATE = 44100
NOTES = [(0.12, 523.251), (0.34, 659.255), (0.56, 783.991), (0.80, 1046.502), (1.08, 1318.510)]
samples = []
for index in range(int(RATE * 2.5)):
    now = index / RATE
    value = 0.0
    for start, frequency in NOTES:
        t = now - start
        if t < 0:
            continue
        envelope = (1 - math.exp(-t / 0.008)) * math.exp(-t / 0.34)
        value += envelope * (math.sin(2 * math.pi * frequency * t)
            + 0.22 * math.exp(-t / 0.15) * math.sin(2 * math.pi * frequency * 2.01 * t)
            + 0.08 * math.exp(-t / 0.08) * math.sin(2 * math.pi * frequency * 3.98 * t))
    # Smooth tail and generous headroom; the player also uses 55% volume.
    value *= min(1, max(0, (2.5 - now) / 0.18))
    samples.append(value)
peak = max(abs(value) for value in samples)
target = Path(__file__).resolve().parents[1] / 'assets/audio/building-complete.wav'
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), 'wb') as audio:
    audio.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
    audio.writeframes(b''.join(struct.pack('<h', round(value / peak * 0.48 * 32767)) for value in samples))
print(f'{target.name}: 2.5 s, 44.1 kHz, PCM16 mono, peak -6.4 dBFS')
