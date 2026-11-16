"""Удаление нарисованной шахматной подложки; разрешено автором 12.09.2026.

Только подготовка ресурсов, для запуска игры этот скрипт и FFmpeg не нужны.
Связная маска строится по нейтральному светлому фону от границ изображения.
Цветные пиксели портретов не перерисовываются. Исходник всегда остаётся отдельно.
"""
import argparse
from collections import deque
import json
from pathlib import Path
import subprocess


def remove_checkerboard(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination:
        raise ValueError("Исходник и результат должны быть разными файлами")
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json", str(source)
    ]))["streams"][0]
    width, height = info["width"], info["height"]
    raw = bytearray(subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(source), "-f", "rawvideo", "-pix_fmt", "rgba", "-"
    ]))
    count = width * height
    candidate = bytearray(count)
    for pixel in range(count):
        offset = pixel * 4
        r, g, b, a = raw[offset:offset+4]
        # Чистая нейтральная сетка, без бежевых волос и серебристо-синих тканей.
        candidate[pixel] = a == 0 or (min(r, g, b) >= 155 and max(r, g, b) - min(r, g, b) <= 14)
    removed = bytearray(count)
    queue = deque()

    def seed(pixel):
        if candidate[pixel] and not removed[pixel]:
            removed[pixel] = 1
            queue.append(pixel)

    for x in range(width):
        seed(x)
        seed((height - 1) * width + x)
    for y in range(height):
        seed(y * width)
        seed(y * width + width - 1)
    while queue:
        pixel = queue.popleft()
        x = pixel % width
        if x:
            seed(pixel - 1)
        if x + 1 < width:
            seed(pixel + 1)
        if pixel >= width:
            seed(pixel - width)
        if pixel + width < count:
            seed(pixel + width)
    # Замкнутые просветы в локонах и между фигурами: ищем обе краски сетки.
    # Маленькие световые блики и белки глаз не затрагиваются.
    examined = bytearray(removed)
    for origin in range(count):
        if examined[origin] or not candidate[origin]:
            continue
        component = []
        queue.append(origin)
        examined[origin] = 1
        while queue:
            pixel = queue.popleft()
            component.append(pixel)
            x = pixel % width
            for neighbor in (pixel-1 if x else -1, pixel+1 if x+1<width else -1, pixel-width, pixel+width):
                if 0 <= neighbor < count and candidate[neighbor] and not examined[neighbor]:
                    examined[neighbor] = 1
                    queue.append(neighbor)
        if len(component) < 90:
            continue
        bright = sum(raw[p*4] > 240 for p in component)
        gray = sum(raw[p*4] < 225 for p in component)
        if bright > len(component)*.15 and gray > len(component)*.15:
            for pixel in component:
                removed[pixel] = 1
    erased = sum(removed)
    if not 0.04 * count < erased < 0.65 * count:
        raise ValueError(f"Подозрительная площадь маски: {erased/count:.1%}")
    for pixel in range(count):
        if removed[pixel]:
            raw[pixel*4:pixel*4+4] = bytes(4)
        elif raw[pixel*4+3]:
            x, y = pixel % width, pixel // width
            if 0 < x < width-1 and 0 < y < height-1:
                neighbors = sum(removed[pixel+dy*width+dx] for dy in (-1,0,1) for dx in (-1,0,1))
                if neighbors:
                    # Однопиксельный антиалиасинг границы; RGB портрета не меняется.
                    raw[pixel*4+3] = min(raw[pixel*4+3], round(255 * (1-neighbors/12)))
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", f"{width}x{height}", "-i", "-", "-frames:v", "1", "-update", "1", str(destination)
    ], input=raw, check=True)
    return {"source": str(source), "destination": str(destination), "width": width, "height": height,
            "transparent_pixels": erased, "background_percent": round(100*erased/count, 2)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(remove_checkerboard(args.source, args.destination), ensure_ascii=True))
