"""Original Day Rhythm compositions. Python standard library only; no sampled music.
Run from any directory: python assets/compose.py
"""
import math
import wave
from array import array
from pathlib import Path

RATE = 32000
ROOT = Path(__file__).parent
TAU = 2 * math.pi


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def note(track, start, duration, midi, gain=0.15, kind="bell"):
    offset = int(start * RATE)
    frequency = hz(midi)
    for j in range(int(duration * RATE)):
        i = offset + j
        if i >= len(track):
            break
        t = j / RATE
        attack = min(1, t / (0.025 if kind == "bell" else 0.7))
        release = min(1, (duration - t) / (0.35 if kind == "bell" else 1.5))
        if kind == "bell":
            value = (math.sin(TAU * frequency * t) * math.exp(-2.9*t)
                     + 0.28 * math.sin(TAU * frequency * 2 * t) * math.exp(-5*t)
                     + 0.08 * math.sin(TAU * frequency * 3 * t) * math.exp(-8*t))
        else:
            value = (math.sin(TAU * frequency * t)
                     + .17 * math.sin(TAU * frequency * 2.002 * t)
                     + .08 * math.sin(TAU * frequency * 3 * t))
            value *= 0.85 + .15 * math.sin(TAU * .18 * t)
        track[i] += value * gain * attack * max(0, release)


def write(name, track, fade_in=0.03):
    # Mild spatial-free echo: deterministic and safe in mono phone speakers.
    delay = int(.19 * RATE)
    original = track[:]
    for i in range(delay, len(track)):
        track[i] += original[i-delay] * .12
    peak = max(max(abs(n) for n in track), 1)
    scale = .82 / peak
    pcm = array('h')
    for i, value in enumerate(track):
        fade = min(1, i / (fade_in * RATE), (len(track)-1-i) / (.6*RATE))
        pcm.append(int(max(-1, min(1, value * scale * fade)) * 32767))
    with wave.open(str(ROOT / name), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm.tobytes())
    print(f'{name}: {len(track)/RATE:.1f}s, peak {max(abs(v) for v in pcm)/32767:.3f}')


# Morning: original rising D major pentatonic, new voices join gradually.
morning = [0.] * (18 * RATE)
melody = [62, 66, 69, 73, 71, 69, 66, 69, 74, 73, 69, 66, 69, 71, 73, 74,
          66, 69, 73, 78, 76, 74, 73, 74]
for k, pitch in enumerate(melody):
    note(morning, .4 + k*.63, 2.0, pitch, .035 + k*.0045)
for k, root in enumerate([50, 55, 57, 50]):
    for pitch in [root, root+7, root+12]:
        note(morning, k*4.0, 5, pitch, .018 + k*.008, 'pad')
write('morning.wav', morning, .3)

# Nap: bright, short G major bell motif; clear spaced attacks.
nap = [0.] * (6 * RATE)
for t, pitch, amp in [(0.1,79,.28),(.43,83,.25),(.76,86,.23),(1.5,83,.22),
                       (1.83,86,.23),(2.16,91,.2),(3.1,86,.16),(3.55,83,.14)]:
    note(nap,t,1.7,pitch,amp)
write('nap.wav', nap)

# Night: slow Fmaj9 / C6 pad with a descending, breathing bell line.
night = [0.] * (16 * RATE)
for start, chord in [(0,[53,60,64,69]),(6,[48,55,60,69])]:
    for pitch in chord:
        note(night,start,9.7,pitch,.038,'pad')
for t,pitch in [(1.1,81),(3.2,79),(5.3,76),(8.2,74),(10.5,72),(12.3,69)]:
    note(night,t,2.6,pitch,.055)
write('night.wav',night,1.1)
write('silence.wav',[0.]*int(.12*RATE))
