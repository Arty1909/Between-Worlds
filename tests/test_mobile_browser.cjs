// Run against an isolated local server: GAME_TEST_URL=http://127.0.0.1:8772/.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const fixtures=JSON.parse(execFileSync(process.env.PYTHON_BIN||'python',['-c',`
import json,tempfile
from engine import Game,fresh_state,NODES
with tempfile.TemporaryDirectory() as d:
 g=Game(d); views=[]
 for key,node in NODES.items():
  if node.get('character'):
   g.state=fresh_state();g.state.update(node=key,started=True)
   views.append(g.view())
   g.state['beat']=len(node['lines'])-1
   views.append(g.view())
 print(json.dumps(views))
`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}));
const base=process.env.GAME_TEST_URL||'http://127.0.0.1:8772/';
const output=path.join(root,'.work/mobile-qa');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(const width of process.env.TEST_WIDTHS?process.env.TEST_WIDTHS.split(',').map(Number):[320,360,390,600,844,1440]){
   const context=await browser.newContext({viewport:{width,height:width===320?610:width===844?390:844},isMobile:width<900,hasTouch:width<900,deviceScaleFactor:width<900?2:1});
   await context.addInitScript(()=>localStorage.setItem('between-worlds-language','ru'));
   const page=await context.newPage(),errors=[],missing=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('response',r=>{if(r.status()>=400)missing.push(r.url());});
   await page.goto(base);await page.waitForFunction(()=>typeof state!=='undefined'&&state&&$('loading').hidden);
   await page.evaluate(()=>{prefs.typewriter=false;prefs.animation=false;applyPrefs();screen='game';});
   for(const scene of fixtures.filter((v,i,a)=>a.findIndex(x=>x.character.id===v.character.id)===i)){
    await page.evaluate(v=>{state=v;render();},scene);
    await page.waitForFunction(()=>$('hero-sprite').dataset.signature===$('hero-sprite').dataset.requested&&$('npc-sprite').dataset.signature===$('npc-sprite').dataset.requested);
    const baseline=await page.evaluate(()=>['hero-stage','portrait-wrap'].map(id=>{const r=$(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    for(const speaker of ['hero',scene.character.id,'hero',scene.character.id]){
     await page.evaluate(s=>{state.line.speaker=s;state.hero_emotion=state.hero_emotion==='warm'?'worried':'warm';state.character.emotion=state.character.emotion==='warm'?'neutral':'warm';render();},speaker);
     await page.waitForFunction(()=>$('hero-sprite').dataset.signature===$('hero-sprite').dataset.requested);
     const boxes=await page.evaluate(()=>['hero-stage','portrait-wrap'].map(id=>{const r=$(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
     assert.deepEqual(boxes,baseline,`${width}px: ${scene.character.id} moved on speaker switch`);
     if(width<=600){
      await page.waitForTimeout(600);
      const visibility=await page.evaluate(()=>['hero-stage','portrait-wrap'].map(id=>getComputedStyle($(id)).visibility));
      assert.deepEqual(visibility,speaker==='hero'?['visible','hidden']:['hidden','visible']);
     }
    }
   }
   assert.equal(await page.locator('.location').count(),0,'location badge was removed');
   for(const speaker of ['hero',fixtures[0].character.id]){
    await page.evaluate(({v,s})=>{state=v;state.line.speaker=s;render();},{v:fixtures[0],s:speaker});
    await page.locator('#scenery-toggle').click();
    await page.waitForTimeout(600);
    for(const id of ['hero-stage','portrait-wrap','story-panel'])assert.equal(await page.locator('#'+id).isVisible(),false,`${id} obscures scenery`);
    assert.equal(await page.locator('#camera-dragpad').isVisible(),true);
    await page.locator('#scenery-toggle').click();
    assert.equal(await page.locator('#story-panel').isVisible(),true);
    assert.equal(await page.locator(speaker==='hero'?'#hero-stage':'#portrait-wrap').isVisible(),true);
   }
   // A delayed emotion decode must never replace the more recent expression.
   await page.evaluate(async()=>{
    let release;const delayed=new Promise(r=>release=r);
    const actor=state.hero,url=asset(actor.emotion_images.resolve);
    spriteImages.set(url,delayed);
    const old=setSprite($('hero-sprite'),actor,'resolve');
    const latest=setSprite($('hero-sprite'),actor,'warm');
    release();await Promise.all([old,latest]);
    if($('hero-sprite').dataset.emotion!=='warm')throw Error('stale decode replaced latest expression');
   });
   // No floating reaction card; only the active full-size actor is shown on mobile.
   const rectBefore=await page.locator('#hero-stage').boundingBox();
   await page.waitForTimeout(650);
   assert.deepEqual(await page.locator('#hero-stage').boundingBox(),rectBefore);
   assert.equal(await page.locator('#reaction-card').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
   await page.evaluate(()=>{state.line.speaker='hero';state.hero_emotion='worried';render();});
   await page.waitForFunction(()=>$('hero-sprite').dataset.signature===$('hero-sprite').dataset.requested);
   await page.waitForTimeout(650);
   assert.equal(await page.locator('#hero-stage').evaluate(e=>getComputedStyle(e).opacity),'1');
   await page.screenshot({path:path.join(output,`scene-${width}.png`)});
   if(width<=600){
    for(const large of [false,true]){
     await page.evaluate(value=>{prefs.largeText=value;applyPrefs();},large);
     for(const scene of fixtures.filter(v=>v.choices?.length)){
      await page.evaluate(v=>{state=v;dialogueKey=null;render();},scene);
      assert.equal(await page.locator('#choices').isVisible(),false);
      await page.locator('#next-button').click();
      assert.equal(await page.locator('#dialogue').isVisible(),false);
      assert.equal(await page.locator('#choices').isVisible(),true);
      const layout=await page.evaluate(()=>{
       const panel=$('story-panel'),footer=panel.querySelector('.dialogue-footer');
       const p=panel.getBoundingClientRect(),f=footer.getBoundingClientRect();
       return {outerOverflow:panel.scrollHeight-panel.clientHeight,footerInside:f.bottom<=p.bottom,insideViewport:p.bottom<=innerHeight,top:p.top};
      });
      assert.ok(layout.outerOverflow<=1,`${scene.node}: panel itself must not scroll`);
      assert.ok(layout.footerInside&&layout.insideViewport,`${scene.node}: footer is clipped`);
      const last=page.locator('#choices button').last();await last.scrollIntoViewIfNeeded();
      await last.evaluate(el=>{const r=el.getBoundingClientRect();if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('last answer obscured');});
      await page.locator('#choice-back').click();assert.equal(await page.locator('#dialogue').isVisible(),true);
     }
    }
    const forge=fixtures.find(v=>v.node==='forge_lunch'&&v.choices?.length);
    await page.evaluate(v=>{prefs.largeText=false;applyPrefs();state=v;dialogueKey=null;render();},forge);
    await page.waitForTimeout(350);
    await page.screenshot({path:path.join(output,`forge-reading-${width}.png`)});
    await page.locator('#next-button').click();
    await page.screenshot({path:path.join(output,`forge-answers-${width}.png`)});
    // Revealing a typed line and opening answers are separate taps, neither advances the story.
    await page.evaluate(v=>{prefs.typewriter=true;state=v;dialogueKey=null;render();},forge);
    const revision=await page.evaluate(()=>state.revision);
    await page.locator('#next-button').click();
    assert.equal(await page.locator('#choices').isVisible(),false);
    assert.equal(await page.locator('#dialogue').textContent(),forge.line.text);
    await page.locator('#next-button').click();
    assert.equal(await page.locator('#choices').isVisible(),true);
    assert.equal(await page.evaluate(()=>state.revision),revision);
    await page.evaluate(()=>{prefs.typewriter=false;});
   }
   if(width===390){
    await page.evaluate(()=>wardrobe());
    await page.waitForFunction(()=>$('wardrobe-hero')?.dataset.signature);
    await page.waitForTimeout(250);
    await page.screenshot({path:path.join(output,'wardrobe-390.png')});
    // All four looks keep all four expressions; the last wardrobe option is reachable.
    for(const look of ['voyage','woodland','moon','lilac'])for(const emotion of ['neutral','warm','worried','resolve']){
     const ok=await page.evaluate(async({look,emotion})=>{
      const actor={...state.hero,image:`assets/characters/v4/hero-${look}-calm.png`,emotion_images:Object.fromEntries(['neutral','warm','worried','resolve'].map(e=>[e,`assets/characters/v4/hero-${look}-${['worried','resolve'].includes(e)?'intense':'calm'}.png`]))};
      return await setSprite($('wardrobe-hero'),actor,emotion);
     },{look,emotion});assert.equal(ok,true);
    }
    await page.evaluate(()=>{closeModal();prefs.animation=true;applyPrefs();currentBackground=null;background('3');});
    await page.waitForFunction(()=>$('world-video').readyState>=2&&$('world-video').currentTime>0);
    const mobileVideo=await page.locator('#world-video').evaluate(v=>({src:v.currentSrc,width:v.videoWidth,height:v.videoHeight}));
    assert.ok(mobileVideo.src.includes('/assets/video/mobile/3.mp4'));
    assert.equal(mobileVideo.width,1920);assert.equal(mobileVideo.height,1080);
    assert.equal(await page.locator('#world-video-next').getAttribute('src'),null);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
   console.log(`${width}px: actor positions, decoding, dialogue/answer steps, large text, reachable last answer, no missing resources passed`);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
