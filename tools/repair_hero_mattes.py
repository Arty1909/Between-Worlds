"""Rebuild the eight authorised hero mattes without repainting the artwork.

Use the measured studio green instead of pure green, and unmix edge pixels.
No erosion, image enlargement or changes to opaque face/clothing pixels.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def repair(name):
    source = ROOT / 'art_sources/v3' / f'{name}-original.png'
    rgb = np.asarray(Image.open(source).convert('RGB')).astype(np.float32)
    r, g, b = rgb.transpose(2, 0, 1)
    excess = g - np.maximum(r, b)
    studio = (g > 180) & (np.maximum(r, b) < 65) & (excess > 130)
    key = np.median(rgb[studio], axis=0)
    # Green is absent from these four costumes. The neutral dark hair and fabric
    # provide a local foreground estimate for mixed green edge pixels.
    opaque = excess <= 8
    known = opaque.copy()
    foreground = rgb.copy()
    for _ in range(18):
        total = np.zeros_like(rgb)
        count = np.zeros_like(g)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            mask = np.roll(known, (dy, dx), (0, 1))
            if dy == 1: mask[0] = False
            if dy == -1: mask[-1] = False
            if dx == 1: mask[:, 0] = False
            if dx == -1: mask[:, -1] = False
            total += np.roll(foreground, (dy, dx), (0, 1)) * mask[..., None]
            count += mask
        fill = ~known & (count > 0)
        foreground[fill] = total[fill] / count[fill, None]
        known |= fill
    # The green-minus-average-red/blue channel is insensitive to hair brightness.
    chroma = g - (r + b) / 2
    fg_chroma = foreground[..., 1] - (foreground[..., 0] + foreground[..., 2]) / 2
    fg_chroma = np.minimum(fg_chroma, 8)
    bg_chroma = key[1] - (key[0] + key[2]) / 2
    alpha = np.clip((bg_chroma - chroma) / np.maximum(bg_chroma - fg_chroma, 1), 0, 1)
    alpha[opaque] = 1
    alpha[~known | studio] = 0
    alpha[alpha < .035] = 0
    edge = (alpha > 0) & (alpha < 1)
    clean = rgb.copy()
    clean[edge] = (rgb[edge] - (1 - alpha[edge, None]) * key) / alpha[edge, None]
    # Residual spill only on mixed edge pixels; opaque artwork stays byte-exact.
    clean[..., 1][edge] = np.minimum(clean[..., 1][edge], np.maximum(clean[..., 0], clean[..., 2])[edge] + 3)
    rgba = np.dstack((np.clip(np.rint(clean), 0, 255).astype('uint8'), np.rint(alpha * 255).astype('uint8')))
    rgba[alpha == 0, :3] = 0
    assert np.array_equal(rgba[opaque, :3], rgb[opaque].astype('uint8'))
    result = Image.fromarray(rgba)
    target = ROOT / 'assets/characters/v4' / f'{name}.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    result.save(target, optimize=True)
    # Inspect hair at 2x against both backgrounds, alongside the previous matte.
    old = Image.open(ROOT / 'assets/characters/v3' / f'{name}.png').convert('RGBA')
    preview = Image.new('RGB', (1200, 800))
    for col, sprite in enumerate((old, result)):
        for row, color in enumerate(('#ede6df', '#191525')):
            panel = Image.new('RGBA', result.size, color)
            panel.alpha_composite(sprite)
            preview.paste(panel.crop((120, 0, 420, 200)).resize((600, 400)), (col * 600, row * 400))
    out = ROOT / '.work/hair-review'
    out.mkdir(parents=True, exist_ok=True)
    preview.save(out / f'{name}.jpg', quality=95)
    return {'name': name, 'key': key.tolist(), 'opaque_preserved': int(opaque.sum()), 'soft_edge_pixels': int(edge.sum())}


if __name__ == '__main__':
    reports = [repair(f'hero-{look}-{emotion}') for look in ('voyage', 'woodland', 'moon', 'lilac') for emotion in ('calm', 'intense')]
    (ROOT / '.work/hair-review/report.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
    print(json.dumps(reports))
