'use strict';
// Only the APK includes this adapter. The website continues to use its server.
const originalFetch=window.fetch.bind(window);
const offlineReady=Promise.all(['story.json','media.json'].map(async p=>{
 const r=await originalFetch(p);if(!r.ok)throw Error('Application data is unavailable.');return r.json();
})).then(([story,media])=>{window.OfflineAssets=media;return new OfflineGame(story,localStorage);});
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin||!['/api/state','/api/action'].includes(url.pathname))return originalFetch(input,options);
 try{
  const game=await offlineReady;
  const result=url.pathname==='/api/state'?{state:game.view(),token:'offline'}:{state:game.act(JSON.parse(options.body))};
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 }catch(e){return new Response(JSON.stringify({error:e.message}),{status:409,headers:{'Content-Type':'application/json'}});}
};
