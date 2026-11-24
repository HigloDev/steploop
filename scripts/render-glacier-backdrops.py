"""Generate lightweight WebP backdrops and harmonized light/dark stairwells for all curated themes."""

import colorsys
import json
import re
from math import atan2, cos, hypot, pi, sin
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 432, 936
HORIZONTAL_WEIGHT = WIDTH ** 2 / (WIDTH ** 2 + HEIGHT ** 2)

# Target hue (0..1) and saturation scale for each theme's harmonized stairwell art.
STAIRWELL_STYLES = {
    'glacier-glass': {
        'keep_light_master': True,
        'hue': 217 / 360,
        'dark_bg': '#16243A',
        'dark_mid': '#243C61',
        'dark_accent': '#8EBBFF',
    },
    'night-run': {
        'keep_light_master': False,
        'hue': 80 / 360,
        'light_paper': '#F3F9F1',
        'light_sat': 0.85,
        'dark_bg': '#142324',
        'dark_mid': '#1F3A36',
        'dark_accent': '#C6F24B',
    },
    'woodland': {
        'keep_light_master': False,
        'hue': 150 / 360,
        'light_paper': '#F8F7EC',
        'light_sat': 0.72,
        'dark_bg': '#12261F',
        'dark_mid': '#1E3E33',
        'dark_accent': '#A5D493',
    },
    'eva-unit-01': {
        'keep_light_master': False,
        'hue': 268 / 360,
        'light_paper': '#F6F2FC',
        'light_sat': 0.82,
        'dark_bg': '#191828',
        'dark_mid': '#2B2648',
        'dark_accent': '#B68EF5',
    },
    'k-on': {
        'keep_light_master': False,
        'hue': 340 / 360,
        'light_paper': '#FDF6F2',
        'light_sat': 0.80,
        'dark_bg': '#2F232C',
        'dark_mid': '#493342',
        'dark_accent': '#F2A7C4',
    },
}


def mix(start, end, amount):
    return tuple(first + (last - first) * amount for first, last in zip(start, end))


def parse_catalog():
    source = (ROOT / 'src/skin-catalog.ts').read_text(encoding='utf-8')
    themes = {}
    entries = re.finditer(r"id:\s*'([^']+)'(.*?)(?=\n\s*\},\n\s*\{|\n\] as const)", source, re.S)
    for match in entries:
        skin_id, body = match.group(1), match.group(2)
        themes[skin_id] = {}
        for mode in ('light', 'dark'):
            mode_match = re.search(rf"{mode}:\s*\{{.*?backdrop:\s*\{{(.*?)\}}", body, re.S)
            if not mode_match:
                continue
            block = mode_match.group(1)
            colors = dict(re.findall(r"(backdropTop|backdropBottom|backdropBloom|bounce):\s*'(#[A-Fa-f0-9]{6})'", block))
            nums = dict(re.findall(r"(backdropBloomOpacity|bounceOpacity):\s*([.\d]+)", block))
            themes[skin_id][mode] = {
                'start': ImageColor.getrgb(colors['backdropTop']),
                'end': ImageColor.getrgb(colors['backdropBottom']),
                'bloom': ImageColor.getrgb(colors['backdropBloom']),
                'bloom_alpha': float(nums['backdropBloomOpacity']),
                'bounce': ImageColor.getrgb(colors['bounce']),
                'bounce_alpha': float(nums['bounceOpacity']),
            }
    return themes


def render_backdrop(skin_id, mode, spec):
    start, end = spec['start'], spec['end']
    bloom, bloom_alpha = spec['bloom'], spec['bloom_alpha']
    reflection, reflection_alpha = spec['bounce'], spec['bounce_alpha']

    pixels = bytearray()
    for y in range(HEIGHT):
        v = (y + 0.5) / HEIGHT
        for x in range(WIDTH):
            u = (x + 0.5) / WIDTH
            if skin_id == 'motion-ring':
                # Diagonal bottom-left deep cobalt -> top-right electric azure/ice sweep aligned with master-icon.png
                diag = max(0.0, min(1.0, u * 0.56 + (1.0 - v) * 0.44))
                base = mix(start, end, diag)
                glow = max(0.0, 1.0 - hypot((u - 0.86) * 0.95, (v - 0.12) * 1.15) / 0.92) ** 1.45 * bloom_alpha
                bounce = max(0.0, 1.0 - hypot((u - 0.10) * 1.1, (v - 0.84) * 1.0) / 0.68) ** 1.5 * reflection_alpha
                pixels.extend(round(channel) for channel in mix(mix(base, bloom, glow), reflection, bounce))
            else:
                base = mix(start, end, u * HORIZONTAL_WEIGHT + v * (1 - HORIZONTAL_WEIGHT))
                glow = max(0.0, 1.0 - hypot(u - 0.82, v - 0.06) / 0.95) * bloom_alpha
                bounce = max(0.0, 1.0 - hypot(u - 0.04, v - 0.74) / 0.52) * reflection_alpha
                pixels.extend(round(channel) for channel in mix(mix(base, bloom, glow), reflection, bounce))

    out_dir = ROOT / 'assets/skins' / skin_id
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f'backdrop-{mode}.webp'
    Image.frombytes('RGB', (WIDTH, HEIGHT), bytes(pixels)).save(output, 'WEBP', lossless=True, method=6)
    return output


def render_stairwells(master_path: Path):
    master = Image.open(master_path).convert('RGB')
    w, h = master.size
    src = list(master.getdata())

    for skin_id, cfg in STAIRWELL_STYLES.items():
        out_dir = ROOT / 'assets/skins' / skin_id
        out_dir.mkdir(parents=True, exist_ok=True)

        # Light stairwell
        if not cfg.get('keep_light_master'):
            target_h = cfg['hue']
            sat_scale = cfg['light_sat']
            paper_rgb = ImageColor.getrgb(cfg['light_paper'])
            light_out = bytearray()
            for r, g, b in src:
                hh, ss, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
                if ss > 0.04:
                    # Preserve subtle hue variations around the original blue (~215 deg).
                    delta_h = hh - (215.0 / 360.0)
                    new_h = (target_h + delta_h * 0.45) % 1.0
                    new_s = min(1.0, ss * sat_scale)
                    rr, gg, bb = colorsys.hsv_to_rgb(new_h, new_s, vv)
                    # Blend pale highlights gently toward the theme paper warmth.
                    warmth = max(0.0, 1.0 - ss * 4.0) * 0.45
                    rr = rr * 255.0 * (1.0 - warmth) + paper_rgb[0] * warmth
                    gg = gg * 255.0 * (1.0 - warmth) + paper_rgb[1] * warmth
                    bb = bb * 255.0 * (1.0 - warmth) + paper_rgb[2] * warmth
                else:
                    rr, gg, bb = mix((r, g, b), paper_rgb, 0.55)
                light_out.extend((max(0, min(255, round(rr))), max(0, min(255, round(gg))), max(0, min(255, round(bb)))))
            Image.frombytes('RGB', (w, h), bytes(light_out)).save(
                out_dir / 'stairwell-light.webp', 'WEBP', quality=86, method=6
            )

        # Dark stairwell: remap white paper wall -> deep card glass, blue accents -> luminous dark accent
        dark_bg = ImageColor.getrgb(cfg['dark_bg'])
        dark_mid = ImageColor.getrgb(cfg['dark_mid'])
        dark_acc = ImageColor.getrgb(cfg['dark_accent'])
        dark_out = bytearray()
        for r, g, b in src:
            _, ss, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            # In the light master, white wall has ss~0.02, vv~0.98; shaded steps have ss~0.18..0.45; handrail has ss>0.7.
            if ss < 0.06:
                shade = max(0.0, min(1.0, (1.0 - vv) * 3.0))
                rr, gg, bb = mix(dark_bg, dark_mid, shade * 0.45)
            elif ss < 0.55:
                t = (ss - 0.06) / 0.49
                mid = mix(dark_bg, dark_mid, 0.35 + t * 0.65)
                rr, gg, bb = mix(mid, dark_acc, (t ** 1.4) * 0.42)
            else:
                t = min(1.0, (ss - 0.55) / 0.40)
                base_acc = mix(dark_mid, dark_acc, 0.55 + t * 0.45)
                # Keep handrail shading depth from original value
                depth = 0.72 + 0.28 * vv
                rr, gg, bb = (base_acc[0] * depth, base_acc[1] * depth, base_acc[2] * depth)
            dark_out.extend((max(0, min(255, round(rr))), max(0, min(255, round(gg))), max(0, min(255, round(bb)))))
        Image.frombytes('RGB', (w, h), bytes(dark_out)).save(
            out_dir / 'stairwell-dark.webp', 'WEBP', quality=86, method=6
        )


def render_motion_ring_stairwells(size=(900, 650)):
    """Render signature frosted 3-tier rounded steps + luminous open ring art for motion-ring."""
    w, h = size
    out_dir = ROOT / 'assets/skins/motion-ring'
    out_dir.mkdir(parents=True, exist_ok=True)

    specs = {
        'light': {
            'bg_bl': (225, 240, 255),
            'bg_tr': (244, 250, 255),
            'bloom': (110, 224, 255),
            'bloom_alpha': 0.24,
            'ring_start': (112, 178, 255),
            'ring_end': (26, 200, 245),
            'ring_alpha': 195,
            'glow_color': (115, 228, 255, 95),
            'step_fill': (188, 222, 255, 165),
            'step_top': (255, 255, 255, 230),
        },
        'dark': {
            'bg_bl': (4, 22, 76),
            'bg_tr': (11, 86, 224),
            'bloom': (52, 215, 255),
            'bloom_alpha': 0.24,
            'ring_start': (186, 224, 255),
            'ring_end': (98, 244, 255),
            'ring_alpha': 235,
            'glow_color': (92, 240, 255, 145),
            'step_fill': (195, 225, 255, 108),
            'step_top': (240, 250, 255, 185),
        },
    }

    cx, cy = int(w * 0.76), int(h * 0.51)
    ring_r = int(min(w, h) * 0.40)
    ring_thick = int(ring_r * 0.13)

    for mode, cfg in specs.items():
        # 1. Diagonal cobalt/ice base canvas
        base_pixels = bytearray()
        for y in range(h):
            v = (y + 0.5) / h
            for x in range(w):
                u = (x + 0.5) / w
                t = max(0.0, min(1.0, u * 0.68 + (1.0 - v) * 0.32))
                c = mix(cfg['bg_bl'], cfg['bg_tr'], t)
                g = max(0.0, 1.0 - hypot((u - 0.84) * 1.1, (v - 0.16) * 1.1) / 0.88) ** 1.6 * cfg['bloom_alpha']
                c = mix(c, cfg['bloom'], g)
                base_pixels.extend((round(c[0]), round(c[1]), round(c[2]), 255))
        canvas = Image.frombytes('RGBA', (w, h), bytes(base_pixels))

        # 2. Luminous open motion ring (leaving crisp 12-o'clock gap like master-icon.png)
        ring_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        glow_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        r_draw = ImageDraw.Draw(ring_layer)
        g_draw = ImageDraw.Draw(glow_layer)

        # Arc from -76 deg clockwise around to 268 deg (open crescent near top)
        steps = 220
        start_deg = -76.0
        span_deg = 336.0
        half_t = ring_thick / 2.0
        for i in range(steps + 1):
            frac = i / steps
            deg = start_deg + frac * span_deg
            rad = deg * pi / 180.0
            px = cx + cos(rad) * ring_r
            py = cy + sin(rad) * ring_r
            # Gradient sweeps cyan on right -> sky at bottom -> ice-blue on left/top-left
            c_frac = 1.0 - abs(frac - 0.22) * 0.9
            c_frac = max(0.0, min(1.0, c_frac))
            col = mix(cfg['ring_start'], cfg['ring_end'], c_frac)
            rgba = (round(col[0]), round(col[1]), round(col[2]), cfg['ring_alpha'])
            r_draw.ellipse((px - half_t, py - half_t, px + half_t, py + half_t), fill=rgba)
            if i == steps or i == 0:
                # Restrained luminous halo at the rounded top cap
                hr = ring_thick * (1.85 if i == steps else 1.2)
                g_draw.ellipse((px - hr, py - hr, px + hr, py + hr), fill=cfg['glow_color'])

        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=22))
        canvas = Image.alpha_composite(canvas, glow_layer)
        canvas = Image.alpha_composite(canvas, ring_layer)

        # 3. Three-tier frosted rounded staircase nestled inside the lower-right arc
        stair_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(stair_layer)
        inner_r = ring_r - ring_thick * 0.95
        # Three ascending rounded blocks clipped to inner circle
        step_rects = [
            (cx - int(inner_r * 0.86), cy + int(inner_r * 0.30), cx + int(inner_r * 0.86), cy + int(inner_r * 0.95)),
            (cx - int(inner_r * 0.30), cy + int(inner_r * 0.02), cx + int(inner_r * 0.86), cy + int(inner_r * 0.95)),
            (cx + int(inner_r * 0.24), cy - int(inner_r * 0.26), cx + int(inner_r * 0.92), cy + int(inner_r * 0.95)),
        ]
        for x0, y0, x1, y1 in step_rects:
            s_draw.rounded_rectangle((x0, y0, x1, y1), radius=24, fill=cfg['step_fill'])
            # Crisp frosted specular top catchlight
            s_draw.rounded_rectangle((x0 + 6, y0, x1 - 6, y0 + 5), radius=3, fill=cfg['step_top'])

        # Mask stairs cleanly inside the inner circle contour (mirroring master-icon.png)
        circle_mask = Image.new('L', (w, h), 0)
        m_draw = ImageDraw.Draw(circle_mask)
        m_draw.ellipse((cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r), fill=255)
        stair_alpha = stair_layer.getchannel('A')
        from PIL import ImageChops
        stair_layer.putalpha(ImageChops.multiply(stair_alpha, circle_mask))
        canvas = Image.alpha_composite(canvas, stair_layer)

        out_path = out_dir / f'stairwell-{mode}.webp'
        canvas.convert('RGB').save(out_path, 'WEBP', quality=86, method=6)
        print(f'motion-ring stairwell: {out_path.relative_to(ROOT)} ({out_path.stat().st_size / 1024:.1f} KB)')


if __name__ == '__main__':
    catalog = parse_catalog()
    for skin_id, modes in catalog.items():
        for mode, spec in modes.items():
            out = render_backdrop(skin_id, mode, spec)
            print(f'backdrop: {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.1f} KB)')
    render_stairwells(ROOT / 'assets/skins/glacier-glass/stairwell.webp')
    render_motion_ring_stairwells()
    print('stairwells rendered for', ', '.join(STAIRWELL_STYLES), '+ motion-ring')
