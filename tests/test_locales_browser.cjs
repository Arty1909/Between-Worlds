const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixtures=JSON.parse(execFileSync(process.env.PYTHON_BIN||'python',['-c',`
import json,tempfile
from engine import Game,fresh_state,NODES,ENDINGS
with tempfile.TemporaryDirectory() as d:
 g=Game(d);result=[]
 for key,node in NODES.items():
  for beat in range(len(node['lines'])):
   g.state=fresh_state('Mira');g.state.update(node=key,beat=beat,started=True);result.append(g.view())
 for key in ENDINGS:
  g.state=fresh_state('Mira');g.state.update(node=key,started=True);result.append(g.view())
 print(json.dumps(result))
`],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',maxBuffer:32*1024*1024}));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
  await page.goto(process.env.GAME_TEST_URL||'http://127.0.0.1:8772/');await page.waitForFunction(()=>typeof state!=='undefined'&&state&&$('loading').hidden);
  assert.equal(await page.evaluate(()=>I18n.language),'en');
  await page.evaluate(()=>{prefs.typewriter=false;prefs.animation=false;applyPrefs();screen='game';});
  const missing={};
  for(const language of ['en','es','it','fr','ru']){
   await page.evaluate(async lang=>{await I18n.change(lang);},language);missing[language]=[];
   for(const view of fixtures){
    const left=await page.evaluate(async v=>{
     clearArrival();document.body.classList.remove('cinematic','cinematic-ready');watchedDoors.add(v.node+':'+v.name);state=v;render();I18n.dom();await Promise.resolve();
     return {dialogue:$('dialogue').textContent,ending:$('ending').innerText,choices:$('choices').textContent,puzzle:$('puzzle').textContent};
    },view);
    if(language!=='ru')for(const [field,text] of Object.entries(left))if(/[А-Яа-яЁё]/.test(text))missing[language].push({node:view.node,beat:view.beat,field,text});
   }
   for(const modal of ['settings','saves','journal','wardrobe']){
    const left=await page.evaluate(async name=>{window[name]();I18n.dom();await Promise.resolve();return $('modal-content').innerText;},modal);
    if(language!=='ru'&&/[А-Яа-яЁё]/.test(left.replace('Русский','')))missing[language].push({modal,text:left});
    await page.evaluate(()=>closeModal());
   }
   for(const tab of ['clues','characters','history']){
    const text=await page.evaluate(t=>{journal(t,true);I18n.dom();return $('modal-content').innerText;},tab);
    if(language!=='ru'&&/[А-Яа-яЁё]/.test(text))missing[language].push({tab,text});
    await page.evaluate(()=>closeModal());
   }
   const attrs=await page.evaluate(()=>[...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap(e=>['aria-label','title','placeholder'].map(a=>e.getAttribute(a)||'')).filter(s=>/[А-Яа-яЁё]/.test(s)));
   if(language!=='ru'&&attrs.length)missing[language].push({attrs});
   console.log(language+': '+fixtures.length+' scenes/lines; untranslated fragments: '+missing[language].length);
  }
  fs.mkdirSync('.work/locales',{recursive:true});fs.writeFileSync('.work/locales/browser-missing.json',JSON.stringify(missing,null,2));
  for(const [lang,rows] of Object.entries(missing))assert.deepEqual(rows,[],`${lang}: missing translations`);
  assert.deepEqual(errors,[]);
  assert.deepEqual(external,[],'translations must not contact an external service');
  await page.evaluate(()=>{screen='home';home();settings();});
  const snapshot=await page.evaluate(()=>JSON.stringify(state));
  await page.locator('#language-select').selectOption('fr');await page.waitForFunction(()=>I18n.language==='fr'&&!$('language-select').disabled);
  assert.equal(await page.evaluate(()=>JSON.stringify(state)),snapshot,'language must not change progress');
  await page.reload();await page.waitForFunction(()=>$('loading').hidden);assert.equal(await page.evaluate(()=>I18n.language),'fr');
  console.log('Default English, selector, unchanged progress, persistence passed');
  const sample=fixtures.find(v=>v.character&&v.node==='forest');
  assert.ok(sample);
  await page.evaluate(v=>{state=v;screen='game';prefs.characters=true;prefs.animation=false;prefs.typewriter=false;applyPrefs();state.line.speaker='hero';render();},sample);
  await page.waitForTimeout(650);
  await page.evaluate(()=>{state.line.speaker=state.character.id;render();});
  await page.waitForTimeout(100);
  const mid=await page.evaluate(()=>+getComputedStyle($('hero-stage')).opacity);
  assert.ok(mid>0&&mid<1,'outgoing character must fade, not disappear instantly');
  await page.waitForTimeout(180);
  const incoming=await page.evaluate(()=>+getComputedStyle($('portrait-wrap')).opacity);
  assert.ok(incoming>0&&incoming<1,'incoming character must fade in');
  await page.evaluate(()=>{for(const speaker of ['hero',state.character.id,'hero']){state.line.speaker=speaker;render();}});
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(()=>getComputedStyle($('hero-stage')).opacity),'1');
  assert.equal(await page.evaluate(()=>getComputedStyle($('portrait-wrap')).visibility),'hidden');
  assert.equal(await page.evaluate(()=>getComputedStyle($('story-panel'),'::after').content),'none','inner rectangle removed');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{state.line.speaker=state.character.id;render();});
  assert.equal(await page.evaluate(()=>getComputedStyle($('hero-stage')).opacity),'0');
  await page.emulateMedia({reducedMotion:'no-preference'});
  console.log('Intermediate fades, rapid changes, reduced motion and removed inner border passed');
  for(const lang of ['en','fr','it','es']){
   await page.evaluate(async l=>{await I18n.change(l);render();},lang);
   await page.setViewportSize({width:320,height:610});
   await page.waitForTimeout(650);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`.work/locales/${lang}-scene.png`});
   await page.evaluate(()=>settings());
   await page.screenshot({path:`.work/locales/${lang}-settings.png`});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.evaluate(()=>closeModal());
   await page.evaluate(()=>home());await page.screenshot({path:`.work/locales/${lang}-home.png`});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.evaluate(()=>{screen='game';render();});
  }
  await page.evaluate(()=>{I18n.context({name:'Луна'});if(I18n.t('Луна')!=='Луна')throw Error('player name translated');});
  const puzzle=fixtures.find(v=>v.kind==='puzzle');
  await page.evaluate(v=>{state=v;screen='game';prefs.typewriter=false;render();selectedRunes=['leaf','flame'];renderPuzzle();settings();},puzzle);
  await page.locator('#language-select').selectOption('en');await page.waitForFunction(()=>I18n.language==='en'&&!$('language-select').disabled);
  assert.deepEqual(await page.evaluate(()=>selectedRunes),['leaf','flame']);
  console.log('Localized mobile layouts, custom name and in-progress puzzle preserved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
