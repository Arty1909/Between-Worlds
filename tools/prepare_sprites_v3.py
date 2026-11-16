"""Prepare authorised sprite cutouts, preserving originals and facial pixels.

Unlike the old checkerboard removal, this keys only the saturated green studio
background; ivory fabric and eye highlights are never treated as background.
Build tool: NumPy and Pillow, not needed by the game.
"""
from pathlib import Path
import json
import shutil
import numpy as np
from PIL import Image, ImageFilter

ROOT=Path(__file__).resolve().parents[1]


def prepare(job):
    src=Path(job['source']); key=job['key']
    master=ROOT/'art_sources/v3'/f'{key}-original.png';master.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(src,master)
    image=Image.open(src).convert('RGBA')
    rgba=np.array(image).astype(np.float32)
    r,g,b=rgba[:,:,0],rgba[:,:,1],rgba[:,:,2]
    green=(g>140)&(g-r>65)&(g-b>65)
    # Detect a chroma background only on the canvas rim, never from costume colour.
    border=np.concatenate((green[0],green[-1],green[:,0],green[:,-1]))
    method='original-alpha'
    if border.mean()>.65:
        method='green-matte'
        excess=np.maximum(g-np.maximum(r,b),0)
        alpha=1-np.clip(excess/np.maximum(255-np.maximum(r,b),1),0,1)
        alpha[green & (np.maximum(r,b)<70)]=0
        alpha[excess<18]=1
        # Unmix the known green matte from semitransparent edge pixels.
        edge=(alpha>0)&(alpha<1)
        rgba[:,:,0][edge]=r[edge]/alpha[edge]
        rgba[:,:,2][edge]=b[edge]/alpha[edge]
        rgba[:,:,1][edge]=(g[edge]-(1-alpha[edge])*255)/alpha[edge]
        rgba[:,:,3]*=alpha
    # Remove a one-pixel contaminated outer rim, keeping the main silhouette.
    alpha_image=Image.fromarray(np.clip(rgba[:,:,3],0,255).astype('uint8'))
    inside=np.asarray(alpha_image.filter(ImageFilter.MinFilter(3)))
    edge=inside<rgba[:,:,3]
    rgba[:,:,3]=np.minimum(rgba[:,:,3],inside.astype(float))
    if method=='green-matte':
        wider=np.asarray(alpha_image.filter(ImageFilter.MinFilter(7)))
        fringe=(wider<rgba[:,:,3])&(rgba[:,:,1]>np.maximum(rgba[:,:,0],rgba[:,:,2])+3)
        rgba[:,:,1][fringe]=(rgba[:,:,0][fringe]+rgba[:,:,2][fringe])/2
    # Some generated alpha files contain saturated red/yellow cutout noise at edges.
    neon=edge & (((r>190)&(g<65)&(b<65))|((r>210)&(g>190)&(b<70)))
    rgba[:,:,3][neon]=0
    rgba=np.clip(rgba,0,255).astype('uint8');rgba[rgba[:,:,3]==0,:3]=0
    result=Image.fromarray(rgba)
    output=ROOT/'assets/characters/v3'/f'{key}.png';output.parent.mkdir(parents=True,exist_ok=True)
    result.save(output,optimize=True)
    # A contact sheet on dark plum exposes fringe and accidental holes clearly.
    panel=Image.new('RGBA',image.size,'#211927');panel.alpha_composite(result)
    preview=ROOT/'.work/v3-mattes'/f'{key}.png';preview.parent.mkdir(parents=True,exist_ok=True)
    panel.convert('RGB').save(preview)
    transparent=float((rgba[:,:,3]==0).mean())
    if not .15<transparent<.9:raise ValueError(f'Unexpected silhouette coverage {key}: {transparent}')
    return {'key':key,'source':str(master.relative_to(ROOT)),'file':str(output.relative_to(ROOT)),
            'size':list(image.size),'method':method,'transparent_percent':round(transparent*100,2), 'prompt':job['prompt']}


if __name__=='__main__':
    jobs=json.loads((ROOT/'.work/v3-art-all.json').read_text(encoding='utf-8'))
    report=[prepare(job) for job in jobs]
    (ROOT/'assets/characters/v3/manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps([{k:v for k,v in entry.items() if k not in ('prompt','source')} for entry in report]))
