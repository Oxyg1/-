"""Синтез саундтрека к promo: бас-пульс, свист, клики набора, выстрел, звон победы, «вжухи»."""
import wave
import numpy as np

SR, DUR = 44100, 21.0
t = np.arange(int(SR * DUR)) / SR
mix = np.zeros_like(t)
rng = np.random.default_rng(3)


def add(at, sig, gain=1.0):
    i = int(at * SR)
    n = min(len(sig), len(mix) - i)
    mix[i:i + n] += gain * sig[:n]


def env(n, a=0.005, d=0.3):
    x = np.arange(n) / SR
    return np.minimum(1, x / a) * np.exp(-x / d)


def tone(f, length, d=0.3, kind="sin"):
    n = int(length * SR)
    x = np.arange(n) / SR
    w = np.sin(2 * np.pi * f * x) if kind == "sin" else np.sign(np.sin(2 * np.pi * f * x)) * 0.5
    return w * env(n, d=d)


# бас-пульс (кроме паузы перед выстрелом и самого финала)
for b in np.arange(0, 20.4, 0.5):
    if 7.4 <= b < 8.6:
        continue
    f = 55 if int(b * 2) % 4 else 41
    add(b, tone(f, 0.45, 0.18), 0.55)
    add(b, tone(f * 2, 0.3, 0.08), 0.15)

# напряжённый тикающий шаг перед сигналом
for b in np.arange(7.0, 8.55, 0.25):
    add(b, rng.standard_normal(1500) * env(1500, 0.001, 0.01), 0.25)

# свист-мелодия в стиле вестерна
mel = [(0.2, 784), (0.55, 1047), (0.9, 988), (1.25, 784), (1.9, 659), (2.3, 784)]
for at, f in mel:
    n = int(0.42 * SR)
    x = np.arange(n) / SR
    vib = np.sin(2 * np.pi * f * x + 0.004 * f * np.sin(2 * np.pi * 6 * x))
    add(at, vib * env(n, 0.03, 0.25), 0.22)
for at, f in [(17.6, 784), (18.0, 1047), (18.4, 988), (18.8, 1175), (19.3, 1047)]:
    n = int(0.5 * SR)
    x = np.arange(n) / SR
    add(at, np.sin(2 * np.pi * f * x + 0.004 * f * np.sin(2 * np.pi * 6 * x)) * env(n, 0.03, 0.3), 0.22)

# удары титров
for at in (0.75, 1.15):
    n = int(0.6 * SR)
    add(at, (rng.standard_normal(n) * 0.5 + np.sin(2 * np.pi * 50 * np.arange(n) / SR)) * env(n, 0.002, 0.15), 0.6)

# клики набора /cduel
for i in range(15):
    add(3.7 + i * 0.06, rng.standard_normal(600) * env(600, 0.0005, 0.004), 0.3)
add(4.9, tone(880, 0.25, 0.08), 0.25)
add(5.0, tone(1320, 0.25, 0.08), 0.2)
add(5.95, tone(660, 0.15, 0.04), 0.3)

# выстрел
n = int(1.2 * SR)
bang = rng.standard_normal(n) * env(n, 0.001, 0.12) + np.sin(2 * np.pi * 45 * np.arange(n) / SR) * env(n, 0.001, 0.25)
add(8.6, bang, 0.9)
# рикошет
n = int(0.5 * SR)
x = np.arange(n) / SR
add(8.75, np.sin(2 * np.pi * (2400 - 2600 * x) * x) * env(n, 0.002, 0.15), 0.12)
# тап и счётчик
add(9.05, tone(1200, 0.08, 0.02), 0.3)
for i in range(10):
    add(9.1 + i * 0.06, tone(1500 + i * 60, 0.04, 0.01), 0.08)

# звон победы
for i, f in enumerate([523, 659, 784, 1047]):
    add(11.2 + i * 0.09, tone(f, 1.2, 0.5), 0.18)
add(12.7, tone(1568, 0.6, 0.2), 0.15)

# вжухи на сменах сцен и карточках
for at in (2.9, 6.4, 10.9, 14.4, 14.85, 15.3, 17.3):
    n = int(0.4 * SR)
    w = rng.standard_normal(n)
    w = np.convolve(w, np.ones(30) / 30, "same")
    add(at, w * np.sin(np.pi * np.arange(n) / n) ** 2, 0.5)

mix *= np.minimum(1, (DUR - t) / 0.6)
mix = np.tanh(mix * 1.2) * 0.85
data = (mix * 32767).astype("<i2")
with wave.open("sound.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
