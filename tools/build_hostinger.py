"""Build a clean Hostinger release; never publish author saves or reference photos."""
import json
import re
from pathlib import Path
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine
from story_edition3 import rewrite_names


def build(destination=None):
    target = Path(destination) if destination else ROOT / '.work' / 'hostinger-release'
    if target.exists():
        raise RuntimeError(f'Use a fresh destination to avoid stale/private files: {target}')
    public = target
    public.mkdir(parents=True)
    for name in ('.htaccess','.user.ini','api.php','private/.htaccess','private/Game.php'):
        source=ROOT/'hosting'/name
        out=public/name;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,out)
    for source in (ROOT/'web').iterdir():
        if source.suffix in ('.css','.js','.webmanifest'):
            out=public/'web'/source.name;out.parent.mkdir(exist_ok=True);shutil.copy2(source,out)
    for code in ('en','ru','es','it','fr'):
        source=ROOT/'web/locales'/f'{code}.json'
        out=public/'web/locales'/source.name;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,out)
    data = {k: getattr(engine, v) for k,v in {'nodes':'NODES','characters':'CHARACTERS','chapters':'CHAPTERS','clues':'CLUES','endings':'ENDINGS','hero':'HERO','emotions':'EMOTIONS','looks':'LOOKS','stay_lives':'STAY_LIVES','puzzle_symbols':'PUZZLE_SYMBOLS','puzzle_answer':'PUZZLE_ANSWER','stat_names':'STAT_NAMES'}.items()}
    data['fresh']=engine.fresh_state()
    (public/'private/story.json').write_text(json.dumps(rewrite_names(data),ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    # Collect only assets referenced by the active edition, plus the actual sound/video files.
    paths=set()
    def collect(value):
        if isinstance(value,dict):
            for item in value.values(): collect(item)
        elif isinstance(value,(tuple,list)):
            for item in value: collect(item)
        elif isinstance(value,str) and value.startswith('assets/') and (ROOT/value).is_file(): paths.add(value)
    collect(data)
    # Ship the selected branding only; keep rejected icon drafts in the workspace.
    for source in (ROOT/'web').iterdir():
        if source.suffix in ('.html','.css','.js','.webmanifest'):
            for asset in re.findall(r'assets/branding/[\w.-]+', source.read_text(encoding='utf-8')):
                if not (ROOT/asset).is_file():
                    raise FileNotFoundError(f'Missing branding asset: {asset}')
                paths.add(asset)
    for folder,extensions in [('backgrounds',{'.jpg','.png'}),('music',{'.mp3'}),('video',{'.mp4'})]:
        paths.update(p.relative_to(ROOT).as_posix() for p in (ROOT/'assets'/folder).rglob('*') if p.suffix in extensions)
    paths.update(f'materials/{i}.mp4' for i in ['0','2','3','4','5','6','7','8','9'])
    # Legacy frontend fallback, never shown when the API supplied a hero, uses this atlas.
    paths.add('assets/characters/v4/hero-voyage-calm.png')
    for path in sorted(paths):
        out=public/path;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/path,out)
    app=public/'web/app.js';text=app.read_text(encoding='utf-8')
    text=text.replace('Python не отвечает. Проверь окно запуска игры.','Игра временно недоступна. Обнови страницу через несколько секунд.')
    text=text.replace('Потеряна связь с Python. Проверь окно запуска и попробуй снова.','Потеряна связь с сервером. Проверь интернет и попробуй снова.')
    text=text.replace('Нет связи с Python · последний прогресс сохранён','Нет связи с сервером · последний прогресс сохранён')
    text=text.replace('Запусти «Запустить игру.bat» и обнови эту страницу.','Проверь подключение к интернету и попробуй ещё раз.')
    app.write_text(text,encoding='utf-8')
    text=(ROOT/'web/index.html').read_text(encoding='utf-8').replace('Сюжет и сохранения обрабатывает Python на твоём компьютере.','Сюжет и сохранения обрабатывает сервер игры.')
    (public/'index.html').write_text(text,encoding='utf-8')
    archive=ROOT/'archives'/'between-worlds.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(public.rglob('*')):
            if p.is_file(): z.write(p,p.relative_to(public).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
    print(json.dumps({'staging':str(target),'zip':str(archive),'bytes':archive.stat().st_size,'public_files':len([p for p in public.rglob('*') if p.is_file()])},ensure_ascii=False))
    return target

if __name__=='__main__': build(sys.argv[1] if len(sys.argv)>1 else None)
