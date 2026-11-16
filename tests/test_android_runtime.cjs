// Runs only against the isolated QA emulator's debug WebView (adb forward tcp:9227 ...).
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:9227/json')).json();
 const socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl),pending=new Map(),errors=[];let serial=0;
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);if(r.error)p.reject(Error(r.error.message));else p.resolve(r.result);}else if(r.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(r.params));};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},60000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Page.enable');
 const page={
  async evaluate(fn,arg){const r=await send('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)??''})`,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;},
  async waitForFunction(fn,options={}){const start=Date.now();while(Date.now()-start<(options.timeout||30000)){try{if(await this.evaluate(fn))return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Timed out: '+fn);},
  async reload(){await send('Page.reload');await new Promise(r=>setTimeout(r,1500));},
  async screenshot({path}){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path,Buffer.from(r.data,'base64'));}
 };
 await page.waitForFunction(()=>typeof state!=='undefined'&&state&&$('loading').hidden,{timeout:45000});
 if(!process.argv.includes('--tail')){
 const first=await page.evaluate(()=>({language:I18n.language,images:Object.keys(OfflineAssets).length,origin:location.origin}));
 assert.equal(first.origin,'https://appassets.androidplatform.net');assert.ok(first.images>20);
 await page.evaluate(async()=>{await action('new',{name:'Arty QA'});prefs.typewriter=false;applyPrefs();await action('dress',{look:'lilac'});await action('save',{slot:'2'});});
 const expected=await page.evaluate(()=>({node:state.node,name:state.name,look:state.look}));
 await page.reload();await page.waitForFunction(()=>typeof state!=='undefined'&&state&&$('loading').hidden);
 assert.deepEqual(await page.evaluate(()=>({node:state.node,name:state.name,look:state.look})),expected);
 for(const language of ['ru','es','it','fr','en'])await page.evaluate(async l=>{await I18n.change(l);settings();closeModal();},language);
 const failed=await page.evaluate(async()=>{
  const bad=[];
  for(const path of new Set(Object.values(OfflineAssets))){
   if(path.endsWith('.webp')){const im=new Image();im.src=path;try{await im.decode();}catch(e){bad.push(path);}}
  }
  return bad;
 });assert.deepEqual(failed,[],'bundled images failed to decode');
 for(const id of ['0','2','3','4','5','6','7','8','9','10']){
  await page.evaluate(id=>{clearArrival();document.body.classList.remove('cinematic','cinematic-ready');prefs.animation=true;applyPrefs();background(id);},id);
  await page.waitForFunction(()=>$('world-video').readyState>=2&&$('world-video').currentTime>0,{timeout:45000});
  assert.equal(await page.evaluate(()=>$('world-video').error),null);
  console.log('Android video '+id+' decoded.');
 }
 }
 for(const [start,end] of [[0,99],[100,199],[1000000,1000099]]){
  const range=await page.evaluate(async ([start,end])=>{const r=await fetch(asset('assets/video/mobile/3.mp4'),{headers:{Range:`bytes=${start}-${end}`}});const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==end-start+1)throw Error('Incorrect byte-range length: '+bytes.length);return {status:r.status,bytes:[...bytes]};},[start,end]);
  assert.ok([200,206].includes(range.status));
  assert.deepEqual(range.bytes,[...fs.readFileSync('.work/android-media/video/3.mp4').subarray(start,end+1)],'range must return exactly the requested bytes');
 }
 console.log('Exact video byte ranges verified.');
 const tracks=await page.evaluate(async()=>{const ctx=new AudioContext();let count=0;try{for(const id of Object.keys(WORLD_TRACKS)){const r=await fetch('assets/music/'+id+'.mp3');if(!r.ok)throw Error('Missing track: '+id);const audio=await ctx.decodeAudioData(await r.arrayBuffer());if(audio.duration<1)throw Error('Empty track: '+id);count++;}return count;}finally{await ctx.close();}});
 assert.equal(tracks,12);
 await page.evaluate(()=>{background('11');backdrop.begin();});
 await page.waitForFunction(()=>$('world-video').videoHeight===1920&&$('world-video').currentTime>0,{timeout:45000});
 await page.evaluate(()=>{backdrop.main.currentTime=backdrop.main.duration-.2;});
 await page.waitForFunction(()=>backdrop.holding,{timeout:15000});
 await page.evaluate(async()=>{await action('load',{slot:'2'});prefs.typewriter=false;applyPrefs();});
 await page.waitForFunction(()=>$('hero-sprite').dataset.signature===$('hero-sprite').dataset.requested);
 fs.mkdirSync('.work/android-qa',{recursive:true});
 await page.screenshot({path:'.work/android-qa/game.png'});
 assert.deepEqual(errors,[]);
 console.log('Android WebView OFFLINE: saves/reload, five languages, all images, 10 HD world videos, range seeking, one-shot portrait door passed.');
 socket.close();
})().catch(e=>{console.error(e);process.exit(1);});
