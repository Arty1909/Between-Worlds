const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=JSON.parse(execFileSync(process.env.PYTHON_BIN||'python',['-c',
 "import tempfile,json; from engine import Game; d=tempfile.TemporaryDirectory(); g=Game(d.name); g.state.update(node='threshold',beat=0,started=True); print(json.dumps(g.view()))"
],{encoding:'utf8',cwd:path.resolve(__dirname,'..')}));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(const [width,height] of [[320,610],[390,844],[1440,900]]){
   const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(process.env.GAME_TEST_URL||'http://127.0.0.1:8772/');
   await page.waitForFunction(()=>typeof state!=='undefined'&&state&&$('loading').hidden);
   await page.evaluate(v=>{prefs.typewriter=false;prefs.animation=true;screen='game';state=v;render();},fixture);
   await page.waitForFunction(()=>$('world-video').readyState>=2&&$('world-video').currentTime>0);
   const media=await page.locator('#world-video').evaluate(v=>({w:v.videoWidth,h:v.videoHeight,loop:v.loop,source:v.currentSrc}));
   assert.equal(media.loop,false);assert.equal(media.w, width<600?1080:1920);assert.equal(media.h,width<600?1920:1080);
   assert.equal(await page.locator('#backdrop').evaluate(e=>getComputedStyle(e).transform),'none');
   assert.equal(await page.locator('#cinematic-continue').isDisabled(),true);
   await page.evaluate(()=>{finishCinematic();next();});
   assert.equal(await page.evaluate(()=>document.body.classList.contains('cinematic')),true,'early click skipped door');
   for(const second of [1,10]){
    await page.locator('#world-video').evaluate((v,t)=>new Promise(resolve=>{v.pause();v.addEventListener('seeked',resolve,{once:true});v.currentTime=t;}),second);
    fs.mkdirSync('.work/door-qa',{recursive:true});
    await page.screenshot({path:`.work/door-qa/${width}-${second}.png`});
   }
   await page.locator('#world-video').evaluate(v=>{v.currentTime=v.duration-.1;return v.play();});
   await page.waitForFunction(()=>backdrop.holding);
   assert.equal(await page.locator('#cinematic-continue').isEnabled(),true);
   const held=await page.locator('#world-video').evaluate(v=>v.currentTime);
   await page.waitForTimeout(350);
   assert.equal(await page.locator('#world-video').evaluate(v=>v.currentTime),held);
   await page.locator('#cinematic-continue').click();
   assert.equal(await page.evaluate(()=>document.body.classList.contains('cinematic')),false);
   assert.deepEqual(errors,[]);
   console.log(`${width}x${height}: door framing, source dimensions, no skipping, final frame hold and explicit continue passed`);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
