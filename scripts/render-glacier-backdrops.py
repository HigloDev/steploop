"""Rasterize the Glacier background tokens without changing the original framing."""

import re
from math import hypot
from pathlib import Path

from PIL import Image, ImageColor


ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 432, 936
HORIZONTAL_WEIGHT = WIDTH ** 2 / (WIDTH ** 2 + HEIGHT ** 2)


def mix(start, end, amount):
    return tuple(first + (last - first) * amount for first, last in zip(start, end))


def render(mode, reflection, reflection_alpha):
    theme = (ROOT / 'src/theme.ts').read_text(encoding='utf-8')
    block = re.search(rf'const glass{mode.title()}: GlassTokens = \{{(.*?)\n\}}', theme, re.S).group(1)
    colors = dict(re.findall(r"(backdrop\w+): '(#[A-Fa-f0-9]{6})'", block))
    start, end, bloom = (ImageColor.getrgb(colors[key]) for key in ('backdropTop', 'backdropBottom', 'backdropBloom'))
    bloom_alpha = float(re.search(r'backdropBloomOpacity: ([.\d]+)', block).group(1))

    pixels = bytearray()
    for y in range(HEIGHT):
        v = (y + .5) / HEIGHT
        for x in range(WIDTH):
            u = (x + .5) / WIDTH
            base = mix(start, end, u * HORIZONTAL_WEIGHT + v * (1 - HORIZONTAL_WEIGHT))
            glow = max(0, 1 - hypot(u - .82, v - .06) / .95) * bloom_alpha
            bounce = max(0, 1 - hypot(u - .04, v - .74) / .52) * reflection_alpha
            pixels.extend(round(channel) for channel in mix(mix(base, bloom, glow), reflection, bounce))

    output = ROOT / f'assets/skins/glacier-glass/backdrop-{mode}.webp'
    Image.frombytes('RGB', (WIDTH, HEIGHT), bytes(pixels)).save(output, 'WEBP', lossless=True, method=6)


if __name__ == '__main__':
    render('light', (179, 232, 234), .62)
    render('dark', (63, 140, 156), .25)
