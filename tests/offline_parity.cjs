const fs=require('node:fs'),Game=require('../android/offline-engine.js');
const {data,runs}=JSON.parse(fs.readFileSync(0,'utf8'));
for(let run=0;run<runs.length;run++){
 let raw=null;const storage={getItem:()=>raw,setItem:(_,v)=>raw=v};let game=new Game(data,storage);
 console.log(JSON.stringify({run,step:-1,view:game.view()}));
 runs[run].forEach((payload,step)=>{
  let result;try{result={view:game.act(payload)};game=new Game(data,storage);}catch(e){result={error:e.message};}
  console.log(JSON.stringify({run,step,...result}));
 });
}
