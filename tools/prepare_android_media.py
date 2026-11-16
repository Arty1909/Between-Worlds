"""Standalone APK media cache. Originals and web release remain untouched."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess, json
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.work/android-media'

def video(key):
    source=ROOT/f'materials/{key}.mp4' if key not in ('10','11','door-landscape') else ROOT/('assets/video/moon-clean.mp4' if key=='10' else 'assets/video/door-once.mp4')
    dest=OUT/f'video/{key}.mp4';dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists(): return
    args=['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-an']
    if key=='11':
        filters=('[0:v]crop=1440:1080:240:0,scale=1080:810,split=2[sharp][surround];'
                 '[surround]pad=1080:1920:0:555,fillborders=top=555:bottom=555:mode=reflect,boxblur=42:2[bg];'
                 "[sharp]format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*min(1,min(Y/60,(H-1-Y)/60))'[scene];"
                 '[bg][scene]overlay=0:555,setsar=1,fps=30[out]')
        args+=['-filter_complex',filters,'-map','[out]']
    else:
        args+=['-vf',r'scale=w=min(1920\,iw):h=min(1080\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=24']
    temp=dest.with_suffix('.encoding.mp4')
    subprocess.run(args+['-c:v','libx264','-preset','slow','-crf','22' if key in ('11','door-landscape') else '23','-maxrate','3M','-bufsize','6M','-pix_fmt','yuv420p','-profile:v','main','-movflags','+faststart','-threads','2',str(temp)],check=True)
    temp.replace(dest)
    print(json.dumps({'video':key,'MiB':round(dest.stat().st_size/1048576,2)}),flush=True)

def images():
    root=ROOT/'web-build/assets'
    for source in list((root/'characters').rglob('*.png'))+list((root/'backgrounds').glob('*')):
        if source.suffix.lower() not in ('.png','.jpg'): continue
        dest=OUT/source.relative_to(root).with_suffix('.webp');dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists():continue
        with Image.open(source) as im:
            # Exact RGBA for portraits: no halos, resampling or detail removal.
            im.save(dest,'WEBP',lossless=True,method=6)
    print('Lossless WebP images ready.',flush=True)

if __name__=='__main__':
    images()
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(video,['0','2','3','4','5','6','7','8','9','10','11','door-landscape']))
