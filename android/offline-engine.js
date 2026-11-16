/* Offline edition of engine.py. One atomic storage record contains state and slots. */
(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
class OfflineGame {
 constructor(data,storage){
  this.d=data;this.storage=storage;this.key='between-worlds-offline-v1';
  const raw=storage.getItem(this.key);
  this.record=raw?JSON.parse(raw):{revision:0,state:copy(data.fresh),slots:{}};
  this.validate(this.record.state);
  if(!Number.isInteger(this.record.revision)||!this.record.slots)throw Error('Saved progress could not be read.');
 }
 get state(){return this.record.state;}
 set state(s){this.record.state=s;}
 validate(s){
  const d=this.d,n=d.nodes[s?.node];
  if(s?.schema!==1||!d.looks[s.look]||(!n&&!d.endings[s.node])||typeof s.name!=='string'||[...s.name].length<1||[...s.name].length>24)throw Error('Saved progress could not be read.');
  if(!Number.isInteger(s.beat)||s.beat<0||s.beat>=(n?.lines.length||1))throw Error('Saved dialogue could not be read.');
  for(const [key,keys,max] of [['stats',Object.keys(d.stat_names),30],['bonds',Object.keys(d.characters),10]]){
   if(!s[key]||Object.keys(s[key]).length!==keys.length||keys.some(k=>!Number.isInteger(s[key][k])||s[key][k]<0||s[key][k]>max))throw Error('Saved attributes could not be read.');
  }
  if(s.stats.wisdom>3||s.stats.shards>3||!Number.isInteger(s.puzzle_attempts)||s.puzzle_attempts<0||s.puzzle_attempts>9999)throw Error('Saved puzzle could not be read.');
  for(const [key,valid] of [['flags',d.flags],['clues',Object.keys(d.clues)],['met',Object.keys(d.characters)]]){
   if(!Array.isArray(s[key])||new Set(s[key]).size!==s[key].length||s[key].some(v=>!valid.includes(v)))throw Error('Saved decisions could not be read.');
  }
  if(typeof s.started!=='boolean'||typeof s.puzzle_solved!=='boolean'||!Array.isArray(s.history)||s.history.length>400||s.history.some(l=>typeof l.text!=='string'||typeof l.speaker!=='string'))throw Error('Saved history could not be read.');
  if(s.feedback&&(!d.nodes[s.feedback.next]&&!d.endings[s.feedback.next]||typeof s.feedback.text!=='string'||!Array.isArray(s.feedback.effects)))throw Error('Saved choice could not be read.');
 }
 chapter(s=this.state){return this.d.nodes[s.node]?.chapter??5;}
 location(s=this.state){return this.d.nodes[s.node]?.location??this.d.endings[s.node].title;}
 available(c){return Object.entries(c.requires||{}).every(([k,v])=>(this.state[k]??this.state.stats[k]??0)>=v);}
 log(line){const text=line.when&&!this.state.flags.includes(line.when)?line.alternate:line.text;this.state.history.push({speaker:line.speaker,text:text.replaceAll('{name}',this.state.name)});this.state.history=this.state.history.slice(-400);}
 enter(id){Object.assign(this.state,{node:id,beat:0,feedback:null});const n=this.d.nodes[id];if(n){for(const [key,value] of [['clues',n.clue],['met',n.character]])if(value&&!this.state[key].includes(value))this.state[key].push(value);this.log(n.lines[0]);}}
 slots(){return ['auto','1','2','3'].map(slot=>{const entry=this.record.slots[slot];return entry?{slot,exists:true,name:entry.state.name,chapter:this.chapter(entry.state),location:this.location(entry.state),saved_at:entry.saved_at}:{slot,exists:false};});}
 write(slot){this.record.slots[slot]={state:copy(this.state),saved_at:new Date().toISOString()};}
 view(){
  const s=this.state,d=this.d;
  const r={revision:this.record.revision,edition:3,name:s.name,started:s.started,hero:{...d.hero,...d.looks[s.look],name:s.name},emotions:d.emotions,look:s.look,looks:Object.entries(d.looks).map(([id,v])=>({id,...v})),stats:s.stats,chapter:this.chapter(),chapters:d.chapters,location:this.location(),node:s.node,warning:'',clues:s.clues.map(id=>({id,...d.clues[id]})),characters:Object.entries(d.characters).map(([id,c])=>({id,...c,met:s.met.includes(id),bond:s.bonds[id]})),history:s.history,slots:this.slots(),feedback:s.feedback,puzzle_solved:s.puzzle_solved};
  if(d.endings[s.node]){
   const ending=copy(d.endings[s.node]);let who='loony';
   for(const k of ['merry','moony'])if(s.bonds[k]>s.bonds[who])who=k;
   for(const [flag,k] of [['stay_forest','loony'],['stay_garden','merry'],['stay_beacon','moony']])if(s.flags.includes(flag))who=k;
   ending.text=ending.text.replaceAll('{companion}',d.characters[who].name);
   if(s.node==='ending_stay')[ending.bg,ending.text]=d.stay_lives[who];
   ending.afterword=s.flags.includes('echo_released')?(ending.after_echo||''):s.flags.includes('echo_remembered')?'В дневнике остался голос Элиан. Её история ещё не закончена, но теперь она больше не забыта.':'';
   Object.assign(r,{kind:'ending',ending,bg:ending.bg,character:s.node==='ending_stay'?{id:who,...d.characters[who]}:null});
  }else{
   const n=d.nodes[s.node],line=copy(n.lines[s.beat]),who=n.character;
   if(line.when&&!s.flags.includes(line.when))line.text=line.alternate;
   line.text=line.text.replaceAll('{name}',s.name);
   let emotion=line.emotion||'neutral',hero_emotion=line.hero_emotion||'neutral';
   if(s.feedback){const e=s.feedback.effects.join('\n');if(e.includes('доверие'))emotion=hero_emotion='warm';else if(n.kind==='quiz')emotion=hero_emotion=e.includes('Верных ответов')?'warm':'worried';else hero_emotion='resolve';}
   const last=s.beat===n.lines.length-1;
   Object.assign(r,{kind:n.kind||'story',bg:n.bg,line,framing:n.framing||'medium',beat:s.beat,beats:n.lines.length,choices:last&&!s.feedback?n.choices.map((c,id)=>({id,text:c.text,label:c.label,available:this.available(c)})):[],character:who?{id:who,...d.characters[who],emotion}:null,hero_emotion,can_advance:!!s.feedback||!last});
   if(n.kind==='puzzle')Object.assign(r,{symbols:d.puzzle_symbols,puzzle_attempts:s.puzzle_attempts});
  }
  r.media={poster:`assets/backgrounds/${r.bg}.jpg`,video:/^\d+$/.test(r.bg)?`materials/${r.bg}.mp4`:null};
  if(r.bg==='room-v2')r.media.poster='assets/backgrounds/room-v2.png';
  if(['10','11'].includes(r.bg))r.media.video=`assets/video/${r.bg==='10'?'moon-clean':'door-once'}.mp4`;
  return copy(r);
 }
 act(p){
  if(p.revision!==this.record.revision)throw Error('Прогресс изменился в другом окне. Обновляем экран — повтори действие.');
  const before=copy(this.record),d=this.d;
  try{
   const action=p.action;
   if(action==='new'){
    if(typeof (p.name??'Арти')!=='string')throw Error('Введи имя героини.');
    const name=(p.name??'Арти').trim().replace(/\s+/gu,' ');
    if([...name].length<1||[...name].length>24||/[\x00-\x1f]/u.test(name))throw Error('Имя должно содержать от 1 до 24 символов.');
    const look=this.state.look;this.state=copy(d.fresh);Object.assign(this.state,{name,look,started:true});this.enter('ordinary_evening');
   }else if(action==='dress'){
    if(typeof p.look!=='string'||!d.looks[p.look])throw Error('Выбери один из образов гардероба.');this.state.look=p.look;
   }else if(action==='load'||action==='save'){
    const slot=String(p.slot);
    if(!['auto','1','2','3'].includes(slot))throw Error('Неизвестная ячейка сохранения.');
    if(action==='load'){if(!this.record.slots[slot])throw Error('В этой ячейке ещё нет сохранения.');this.state=copy(this.record.slots[slot].state);this.validate(this.state);}
    else{if(!this.state.started)throw Error('Сначала начни историю.');if(slot==='auto')throw Error('Выбери одну из трёх ручных ячеек.');this.write(slot);}
   }else if(d.endings[this.state.node]||!this.state.started)throw Error('Начни новую историю или загрузи сохранение.');
   else if(action==='advance'){
    if(this.state.feedback)this.enter(this.state.feedback.next);
    else{const n=d.nodes[this.state.node];if(this.state.beat>=n.lines.length-1)throw Error('Сначала сделай выбор.');this.state.beat++;this.log(n.lines[this.state.beat]);}
   }else if(action==='choose'){
    const n=d.nodes[this.state.node],i=p.choice;
    if(this.state.feedback||this.state.beat!==n.lines.length-1)throw Error('Сначала дочитай реплику.');
    if(!Number.isInteger(i)||i<0||i>=n.choices.length)throw Error('Такого выбора нет.');
    const c=n.choices[i],effects=[];if(!this.available(c))throw Error('Этот путь пока недоступен.');
    for(const [k,v] of Object.entries(c.effects)){if(k.startsWith('bond_')){const who=k.slice(5);this.state.bonds[who]+=v;effects.push(`${d.characters[who].name}: доверие +${v}`);}else{this.state.stats[k]+=v;effects.push(`${d.stat_names[k]} +${v}`);}}
    if(c.clue&&!this.state.clues.includes(c.clue))this.state.clues.push(c.clue);
    for(const f of c.set_flags||[])if(!this.state.flags.includes(f))this.state.flags.push(f);
    this.log({speaker:'hero',text:c.text});this.log({speaker:'narrator',text:c.reply});this.state.feedback={text:c.reply,next:c.next,effects};
   }else if(['puzzle','skip_puzzle'].includes(action)){
    if(this.state.node!=='mechanism'||this.state.feedback)throw Error('Механизм сейчас недоступен.');
    let feedback;
    if(action==='skip_puzzle')feedback={text:'Саэль поворачивает кольца за тебя. «Помощь — тоже часть пути». Дверь открыта, но тайну соединения миров ещё предстоит понять.',next:'last_reflection',effects:['Саэль помогла открыть дверь']};
    else{
     const symbols=p.symbols,valid=d.puzzle_symbols.map(s=>s.id);
     if(!Array.isArray(symbols)||symbols.length!==3||new Set(symbols).size!==3||symbols.some(s=>!valid.includes(s)))throw Error('Выбери три разных символа.');
     this.state.puzzle_attempts=Math.min(this.state.puzzle_attempts+1,9999);
     if(JSON.stringify(symbols)!==JSON.stringify(d.puzzle_answer))feedback={text:'Механизм тихо щёлкает и замирает. Начни с живого, затем вспомни тепло и отражённый свет. Подсказки сохранены в дневнике.',next:'mechanism',effects:['Можно попробовать снова']};
     else{this.state.puzzle_solved=true;feedback={text:'Лист. Пламя. Луна. Три кольца совпадают, и свет пробегает по ключу. Дверь между мирами открыта.',next:'last_reflection',effects:['Лунный механизм разгадан']};}
    }
    this.state.feedback=feedback;this.log({speaker:'narrator',text:feedback.text});
   }else throw Error('Неизвестное действие.');
   this.validate(this.state);this.write('auto');this.record.revision++;
   this.storage.setItem(this.key,JSON.stringify(this.record));
   return this.view();
  }catch(e){this.record=before;throw e;}
 }
}
root.OfflineGame=OfflineGame;
if(typeof module!=='undefined')module.exports=OfflineGame;
})(typeof window==='undefined'?globalThis:window);
