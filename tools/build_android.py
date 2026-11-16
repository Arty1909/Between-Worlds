"""Build a signed offline APK using the installed Android SDK, no Gradle downloads."""
from pathlib import Path
import json,os,re,secrets,shutil,subprocess,sys,zipfile
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import engine
from story_edition3 import rewrite_names
SDK=Path(os.environ.get('ANDROID_HOME',Path.home()/'AppData/Local/Android/Sdk'))
BT=SDK/'build-tools/35.0.0';JAR=SDK/'platforms/android-35/android.jar'
BUILD=ROOT/'android/build';MEDIA=ROOT/'.work/android-media'
DEBUG='--debug' in sys.argv
ARM64='--arm64' in sys.argv
WORK=BUILD/(('debug' if DEBUG else 'release')+('-arm64' if ARM64 else ''))
NDK=SDK/'ndk/28.2.13676358/toolchains/llvm/prebuilt/windows-x86_64'

def run(args):
    result=subprocess.run([str(a) for a in args],capture_output=True,text=True,encoding='utf-8',errors='replace')
    if result.returncode:raise RuntimeError(result.stdout+'\n'+result.stderr)

def prepare():
    if WORK.exists():
        assert WORK.resolve().parent==BUILD.resolve()
        shutil.rmtree(WORK)
    site=WORK/'assets/site';site.mkdir(parents=True)
    for source in (ROOT/'web').rglob('*'):
        if source.is_file() and source.suffix in ('.css','.js','.json','.webmanifest'):
            dest=site/'web'/source.relative_to(ROOT/'web');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
    html=(ROOT/'web/index.html').read_text(encoding='utf-8')
    html=html.replace('<script defer src="web/i18n.js', '<script defer src="offline-engine.js"></script>\n  <script defer src="offline-api.js"></script>\n  <script defer src="web/i18n.js')
    (site/'index.html').write_text(html,encoding='utf-8')
    for name in ('offline-engine.js','offline-api.js'):shutil.copy2(ROOT/'android'/name,site/name)
    data={k:getattr(engine,v) for k,v in {'nodes':'NODES','characters':'CHARACTERS','chapters':'CHAPTERS','clues':'CLUES','endings':'ENDINGS','hero':'HERO','emotions':'EMOTIONS','looks':'LOOKS','stay_lives':'STAY_LIVES','puzzle_symbols':'PUZZLE_SYMBOLS','puzzle_answer':'PUZZLE_ANSWER','stat_names':'STAT_NAMES'}.items()}
    data['fresh']=engine.fresh_state();data['flags']=sorted(engine.FLAGS)
    (site/'story.json').write_text(json.dumps(rewrite_names(data),ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    mapping={}
    for source in MEDIA.rglob('*.webp'):
        rel=source.relative_to(MEDIA);dest=site/'assets'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
        original=Path('assets')/rel.with_suffix('.png')
        if not (ROOT/original).exists():original=original.with_suffix('.jpg')
        mapping[original.as_posix()]=dest.relative_to(site).as_posix()
    for key in ['0','2','3','4','5','6','7','8','9','10','11','door-landscape']:
        source=MEDIA/f'video/{key}.mp4'
        if not source.exists():raise RuntimeError(f'Prepare Android media first: {source}')
        dest=site/f'assets/video/{key}.mp4';dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
        if key=='door-landscape':mapping['assets/video/door-once.mp4']=dest.relative_to(site).as_posix()
        else:
            for old in (f'materials/{key}.mp4',f'assets/video/mobile/{key}.mp4'):
                mapping[old]=dest.relative_to(site).as_posix()
            if key=='10':mapping['assets/video/moon-clean.mp4']=dest.relative_to(site).as_posix()
    for source in (ROOT/'assets/music').glob('*.mp3'):
        dest=site/'assets/music'/source.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
    for source in (ROOT/'assets/branding').glob('icon-key-*.png'):
        dest=site/'assets/branding'/source.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
    (site/'media.json').write_text(json.dumps(mapping,separators=(',',':')),encoding='utf-8')
    app=site/'web/app.js';text=app.read_text(encoding='utf-8')
    text=text.replace('path.split("/").map(encodeURIComponent)', '(window.OfflineAssets?.[path]||path).split("/").map(encodeURIComponent)')
    # APK errors must never instruct the player to start a desktop server.
    messages={
        "Python не отвечает. Проверь окно запуска игры.":("Не удалось загрузить данные игры. Перезапусти приложение.", ["Could not load game data. Restart the app.","No se pudieron cargar los datos del juego. Reinicia la aplicación.","Impossibile caricare i dati di gioco. Riavvia l’app.","Impossible de charger les données du jeu. Relance l’application."]),
        "Потеряна связь с Python. Проверь окно запуска и попробуй снова.":("Не удалось сохранить действие. Освободи место на телефоне и попробуй снова.",["Could not save your action. Free up space on your phone and try again.","No se pudo guardar tu acción. Libera espacio en el teléfono e inténtalo de nuevo.","Impossibile salvare l’azione. Libera spazio sul telefono e riprova.","Impossible d’enregistrer ton action. Libère de l’espace sur ton téléphone et réessaie."]),
        "◈ Нет связи с Python · последний прогресс сохранён":("◈ Ошибка записи · предыдущий прогресс сохранён",["◈ Save failed · previous progress preserved","◈ Error al guardar · progreso anterior conservado","◈ Salvataggio non riuscito · progressi precedenti conservati","◈ Échec de l’enregistrement · progression précédente conservée"]),
        "Запусти «Запустить игру.bat» и обнови эту страницу.":("Закрой и снова открой приложение.",["Close and reopen the app.","Cierra y vuelve a abrir la aplicación.","Chiudi e riapri l’app.","Ferme puis rouvre l’application."])
    }
    for old,(new,_) in messages.items():text=text.replace(old,new)
    for i,lang in enumerate(('en','es','it','fr')):
        locale=site/f'web/locales/{lang}.json';catalogue=json.loads(locale.read_text(encoding='utf-8'))
        for new,translations in messages.values():catalogue[new]=translations[i]
        locale.write_text(json.dumps(catalogue,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    app.write_text(text,encoding='utf-8')
    # APK-only bundled background images are resolved through asset(), as are portraits.
    res=WORK/'res';shutil.copytree(ROOT/'android/res',res)
    with Image.open(ROOT/'assets/branding/icon-key-512.png') as icon:
        for folder,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
            out=res/f'mipmap-{folder}/ic_launcher.png';out.parent.mkdir(parents=True,exist_ok=True);icon.resize((size,size),Image.Resampling.LANCZOS).save(out)
        foreground=Image.new('RGB',(432,432),'#191725');foreground.paste(icon.resize((288,288),Image.Resampling.LANCZOS),(72,72))
        out=res/'drawable-nodpi/icon_foreground.png';out.parent.mkdir(parents=True,exist_ok=True);foreground.save(out)
    manifest=(ROOT/'android/AndroidManifest.xml').read_text(encoding='utf-8')
    if DEBUG:manifest=manifest.replace('android:debuggable="false"','android:debuggable="true"')
    if ARM64:manifest=manifest.replace('<application ', '<application android:extractNativeLibs="true" ')
    (WORK/'AndroidManifest.xml').write_text(manifest,encoding='utf-8')
    return site,res

def build():
    site,res=prepare()
    run([BT/'aapt2.exe','compile','--dir',res,'-o',WORK/'res.zip'])
    run([BT/'aapt2.exe','link','-o',WORK/'unsigned.apk','--manifest',WORK/'AndroidManifest.xml','-I',JAR,WORK/'res.zip','--min-sdk-version','28','--target-sdk-version','35'])
    classes=WORK/'classes';classes.mkdir();dex=WORK/'dex';dex.mkdir()
    target=WORK/'BuildTarget.java'
    target.write_text('package com.betweenworlds.story; final class BuildTarget { static final boolean ARM64_ONLY = '+str(ARM64).lower()+'; }',encoding='utf-8')
    run(['javac','--release','8','-encoding','UTF-8','-classpath',JAR,'-d',classes,target,ROOT/'android/src/com/betweenworlds/story/MainActivity.java'])
    run(['java','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--lib',JAR,'--min-api','28','--output',dex,*classes.rglob('*.class')])
    if ARM64:
        run([NDK/'bin/clang.exe','--target=aarch64-linux-android28','--sysroot='+str(NDK/'sysroot'),'-shared','-fPIC','-Oz','-fvisibility=hidden','-Wl,-z,max-page-size=16384','-Wl,-z,common-page-size=16384','-Wl,-soname,libbw_abi_guard.so','-Wl,--no-undefined','-Wl,--strip-all',ROOT/'android/native/abi_guard.c','-o',WORK/'libbw_abi_guard.so'])
    with zipfile.ZipFile(WORK/'unsigned.apk','a') as z:
        z.write(dex/'classes.dex','classes.dex',compress_type=zipfile.ZIP_DEFLATED)
        if ARM64:z.write(WORK/'libbw_abi_guard.so','lib/arm64-v8a/libbw_abi_guard.so',compress_type=zipfile.ZIP_DEFLATED)
        for source in site.rglob('*'):
            if source.is_file():z.write(source,'assets/site/'+source.relative_to(site).as_posix(),compress_type=zipfile.ZIP_STORED if source.suffix in ('.mp4','.mp3','.webp','.png') else zipfile.ZIP_DEFLATED)
    run([BT/'zipalign.exe','-f','4',WORK/'unsigned.apk',WORK/'aligned.apk'])
    signing=ROOT/'android/signing';signing.mkdir(exist_ok=True)
    key=signing/'between-worlds.jks';password=signing/'store-password.txt'
    if not key.exists():
        if not password.exists():password.write_text(secrets.token_urlsafe(36),encoding='utf-8')
        run(['keytool','-genkeypair','-keystore',key,'-alias','between-worlds','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Between Worlds, O=Between Worlds','-storepass:file',password,'-keypass:file',password])
    out=WORK/'between-worlds-test.apk' if DEBUG else ROOT/'output'/('between-worlds-arm64-v8a.apk' if ARM64 else 'between-worlds.apk');out.parent.mkdir(exist_ok=True)
    run(['java','-jar',BT/'lib/apksigner.jar','sign','--ks',key,'--ks-key-alias','between-worlds','--ks-pass','file:'+str(password),'--v4-signing-enabled','false','--out',out,WORK/'aligned.apk'])
    run(['java','-jar',BT/'lib/apksigner.jar','verify','--verbose',out])
    run([BT/'zipalign.exe','-c','4',out])
    print(json.dumps({'apk':str(out),'MiB':round(out.stat().st_size/1048576,2),'mode':'debug' if DEBUG else 'release','abi':'arm64-v8a' if ARM64 else 'universal','files':len(list(site.rglob('*')))},ensure_ascii=False))

if __name__=='__main__':build()
