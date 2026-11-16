"""Build offline translation drafts from fictional copy; no runtime service calls.

Only web/locales/ru.json is sent. Review results and apply locale_overrides.json.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json,re,time,urllib.request,urllib.parse
ROOT=Path(__file__).resolve().parents[1]
SOURCE=json.loads((ROOT/'web/locales/ru.json').read_text(encoding='utf8'))
NAMES={'Арти':'Arty','Адель':'Adele','Эш':'Ash','Верес':'Veres','Лиор':'Lior','Марен':'Maren','Астрид':'Astrid','Нивель':'Nivelle','Орин':'Orin','Тэсс':'Tess','Саэль':'Sael','Элиан':'Elian'}
def protect(text):
    replacements={}
    def token(value):
        key=f'QZP{len(replacements)}ZQ';replacements[key]=value;return key
    text=re.sub(r'\{[^{}]+\}',lambda m:token(m[0]),text)
    for name,latin in NAMES.items():
        text=re.sub(r'\b'+name+r'(?:а|е|у|ой|ом|ю|и)?\b',lambda m:token(latin),text)
    return text,replacements
def request(batch,lang):
    protected=[protect(s) for s in batch]
    query='\n\n'.join(f'[[[{i:04}]]]\n{v[0]}' for i,v in enumerate(protected))
    url='https://translate.googleapis.com/translate_a/single?'+urllib.parse.urlencode({'client':'gtx','sl':'ru','tl':lang,'dt':'t','q':query})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=35) as response:data=json.load(response)
            translated=''.join(piece[0] or '' for piece in data[0])
            pieces=re.split(r'\[\s*\[\s*\[\s*(\d{4})\s*\]\s*\]\s*\]',translated)
            result={int(pieces[i]):pieces[i+1].strip() for i in range(1,len(pieces),2)}
            if len(result)!=len(batch):raise ValueError('Translation boundaries changed')
            out={}
            for i,source in enumerate(batch):
                text=result[i]
                for key,value in protected[i][1].items():
                    text=re.sub(key,value,text,flags=re.I)
                if re.search(r'QZP\d+ZQ',text,re.I):raise ValueError('Unresolved protected token')
                out[source]=' '.join(text.split())
            return out
        except Exception:
            if attempt==3:raise
            time.sleep(1+attempt*2)
def language(lang):
    path=ROOT/'web/locales'/f'{lang}.json'
    done=json.loads(path.read_text(encoding='utf8')) if path.exists() else {}
    batches=[];batch=[];size=0
    for value in SOURCE:
        if value in done:continue
        if size+len(value)>1300 and batch:batches.append(batch);batch=[];size=0
        batch.append(value);size+=len(value)+20
    if batch:batches.append(batch)
    for i,batch in enumerate(batches):
        done.update(request(batch,lang))
        path.write_text(json.dumps(done,ensure_ascii=False,indent=2),encoding='utf8')
        if i%8==0:print(f'{lang}: {len(done)}/{len(SOURCE)}',flush=True)
    overrides=ROOT/'tools/locale_overrides.json'
    if overrides.exists():done.update(json.loads(overrides.read_text(encoding='utf8')).get(lang,{}))
    path.write_text(json.dumps(done,ensure_ascii=False,indent=2),encoding='utf8')
    print(f'{lang}: complete ({len(done)})',flush=True)
if __name__=='__main__':
    with ThreadPoolExecutor(2) as pool:list(pool.map(language,['en','es','it','fr']))
