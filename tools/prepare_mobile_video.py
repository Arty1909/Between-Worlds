"""Mobile H.264 delivery from originals, preserving detail and square pixels."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/video/mobile'
OUT.mkdir(parents=True,exist_ok=True)
sources={str(i):ROOT/f'materials/{i}.mp4' for i in [0,2,3,4,5,6,7,8,9]}
sources.update({'10':ROOT/'assets/video/moon-clean.mp4','11':ROOT/'assets/video/door-once.mp4'})

def poster(world,source):
    name='door-portrait' if world=='11' else world
    dest=ROOT/f'assets/backgrounds/{name}.jpg'
    temporary=dest.with_name(name+'.encoding.jpg')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','0.1','-i',str(source),
        '-frames:v','1','-q:v','2',str(temporary)],check=True)
    temporary.replace(dest)

def encode(item):
    world,source=item;dest=OUT/f'{world}.mp4';temporary=OUT/f'{world}.encoding.mp4'
    if world=='11':
        # A portrait composition preserves both handles and the opening arch.
        # The soft surround is baked into the same stream, not a second decoder.
        filters=('[0:v]crop=1440:1080:240:0,scale=1080:810,split=2[sharp][surround];'
                 '[surround]pad=1080:1920:0:555,fillborders=top=555:bottom=555:mode=reflect,boxblur=42:2[bg];'
                 "[sharp]format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*min(1,min(Y/60,(H-1-Y)/60))'[scene];"
                 '[bg][scene]overlay=0:555,setsar=1[out]')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),
            '-filter_complex',filters,'-map','[out]','-an','-c:v','libx264','-preset','fast',
            '-crf','19','-pix_fmt','yuv420p','-profile:v','main','-movflags','+faststart','-threads','2',str(temporary)],check=True)
        temporary.replace(dest)
        poster(world,dest)
        return {'world':world,'bytes':dest.stat().st_size,'width':1080,'height':1920,'r_frame_rate':'30/1'}
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-an',
        '-vf','scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=24',
        '-c:v','libx264','-preset','fast','-crf','20','-maxrate','6M','-bufsize','12M','-pix_fmt','yuv420p','-profile:v','main',
        '-movflags','+faststart','-threads','2',str(temporary)],check=True)
    temporary.replace(dest)
    poster(world,dest)
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate:format=duration','-of','json',str(dest)]))
    assert info['streams'][0]['height']<=1080 and info['streams'][0]['r_frame_rate']=='24/1'
    return {'world':world,'bytes':dest.stat().st_size,**info['streams'][0]}

if __name__=='__main__':
    if sys.argv[1:]==['--posters-only']:
        for world in sources: poster(world,OUT/f'{world}.mp4')
        print('Posters refreshed at native delivery resolution.')
        sys.exit(0)
    selected={key:value for key,value in sources.items() if len(sys.argv)==1 or key in sys.argv[1:]}
    with ThreadPoolExecutor(2) as pool:
        for result in pool.map(encode,selected.items()): print(json.dumps(result),flush=True)
