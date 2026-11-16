const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixtures=JSON.parse(execFileSync(process.env.PYTHON_BIN||'python',['-c',`
import json,tempfile
from engine import Game,fresh_state
with tempfile.TemporaryDirectory() as d:
 g=Game(d);views=[]
 for key in ['forest','forge_lunch']:
  g.state=fresh_state();g.state.update(node=key,started=True);views.append(g.view())
 print(json.dumps(views))
`],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/action',r=>r.abort()); // Never write to the author's save.
  await page.goto(process.env.GAME_TEST_URL||'http://127.0.0.1:8772/?v=4.7');
  await page.waitForFunction(()=>typeof state!=='undefined'&&state&&$('loading').hidden);
  for(const [width,height] of [[320,610],[390,844],[430,932],[600,960],[844,390]]){
   await page.setViewportSize({width,height});
   for(const scene of fixtures){
    await page.evaluate(v=>{clearArrival();document.body.classList.remove('cinematic','cinematic-ready','scenery-mode');screen='game';state=v;prefs.typewriter=false;prefs.animation=false;applyPrefs();render();},scene);
    await page.waitForFunction(()=>$('hero-sprite').dataset.signature===$('hero-sprite').dataset.requested&&$('npc-sprite').dataset.signature===$('npc-sprite').dataset.requested);
    for(const speaker of ['hero',scene.character.id]){
     await page.evaluate(s=>{state.line.speaker=s;render();},speaker);
     await page.waitForTimeout(650);
     const geometry=await page.evaluate(id=>{
      const stage=$(id),sprite=stage.querySelector('.sprite'),a=stage.getBoundingClientRect(),b=sprite.getBoundingClientRect();
      return {width:b.width,height:b.height,stageWidth:a.width,left:b.left,right:b.right,view:innerWidth,backdrop:getComputedStyle($('backdrop')).transform};
     },speaker==='hero'?'hero-stage':'portrait-wrap');
     assert.ok(Math.abs(geometry.width/geometry.height-.5)<.002,'sprite aspect ratio changed');
     assert.ok(geometry.width<=geometry.stageWidth+1,'sprite shoulders clipped by stage');
     assert.ok(geometry.left>=-1&&geometry.right<=geometry.view+1,'sprite extends beyond viewport');
     assert.equal(geometry.backdrop,'none','automatic mobile background zoom');
    }
   }
   fs.mkdirSync('.work/media-qa',{recursive:true});
   await page.screenshot({path:`.work/media-qa/${width}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{prefs.animation=true;applyPrefs();background('3');});
  await page.waitForFunction(()=>$('world-video').readyState>=2&&$('world-video').videoHeight===1080);
  const initial=await page.evaluate(()=>({scale:visualViewport.scale,camera:camera.model.zoom}));
  const box=await page.locator('#dialogue').boundingBox();
  for(let i=0;i<6;i++)await page.touchscreen.tap(box.x+box.width/2,box.y+8);
  assert.deepEqual(await page.evaluate(()=>({scale:visualViewport.scale,camera:camera.model.zoom})),initial,'story taps changed zoom');
  await page.evaluate(()=>settings());
  assert.ok(await page.locator('#language-select').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
  await page.evaluate(()=>{closeModal();newGame();});
  assert.ok(await page.locator('#hero-name').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
  assert.equal(await page.evaluate(()=>visualViewport.scale),initial.scale);
  await page.evaluate(()=>closeModal());
  await page.locator('#scenery-toggle').tap();
  await page.locator('[data-camera="left"]').tap();
  assert.ok(await page.evaluate(()=>camera.model.zoom>1.12),'world camera controls broken');
  assert.equal(await page.locator('#camera-dragpad').evaluate(e=>getComputedStyle(e).touchAction),'none');
  await page.locator('#scenery-toggle').tap();
  await page.waitForFunction(()=>getComputedStyle($('backdrop')).transform==='none');
  assert.equal(await page.locator('#backdrop').evaluate(e=>getComputedStyle(e).transform),'none');
  assert.deepEqual(errors,[]);
  console.log('PASS: 5 phone/tablet shapes, both actor ratios/bounds, 1080p playback, repeated taps, readable form fields, separate world camera.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
