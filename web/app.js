"use strict";
const $ = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const asset = path => path.split("/").map(encodeURIComponent).join("/") + "?v=4.7";
let state, token, busy = false, screen = "home", typing = null, fullText = "", afterTyping = null;
let selectedRunes = [], currentBackground = null, toastTimer, modalReturnFocus, speechTimer;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const compactDevice = window.matchMedia("(max-width: 900px), (pointer: coarse)");
let prefs = {sound: false, effects: false, effectVolume: .2, sidebar: false, animation: !reduced, characters: !reduced, typewriter: !reduced, textSpeed: 20, largeText: false, volume: 0.3, glass: 0.65};
try { const saved = JSON.parse(localStorage.getItem("between-worlds-settings") || "null"); if (saved && typeof saved === "object") prefs = {...prefs, ...saved}; } catch (_) {}
delete prefs.ambience;
prefs.textSpeed=Math.max(8,Math.min(40,Number(prefs.textSpeed)||20));
prefs.effectVolume=Math.max(0,Math.min(1,Number(prefs.effectVolume)||0));
prefs.volume = Math.max(0, Math.min(1, Number(prefs.volume) || 0));
prefs.glass = Math.max(0.4, Math.min(0.95, Number(prefs.glass) || 0.65));
const video = $("world-video");
const camera=new WorldCamera();
const music = new WorldMusic(() => toast("Не удалось загрузить музыку этого мира. Проверь папку assets/music."));
const activeTrack = () => screen === "home" ? "11" : state?.node === "ending_home" ? "room-v2" : state?.bg || "11";
const effects=new WorldEffects();
const backdrop=new WorldBackdrop(video,$('world-video-next'),()=>{
  $('cinematic-continue').disabled=false;
  document.body.classList.add('cinematic-ready');$('cinematic-continue').innerHTML='<span>Коснись экрана, чтобы продолжить →</span>';
});
let cinematicKey=null, choiceStep=false, dialogueKey=null;
const watchedDoors=new Set();
const narrowDialogue=window.matchMedia('(max-width: 600px)');
function clearArrival(){
  $('world-arrival').hidden=true;document.body.classList.remove('arrival-active');
  $('game').inert=false;document.querySelector('.topbar').inert=false;
}
function showArrival(caption){
  clearTyping();$('arrival-title').textContent=caption.title;$('arrival-text').textContent=caption.text;
  $('world-arrival').hidden=false;document.body.classList.add('arrival-active');
  $('game').inert=true;document.querySelector('.topbar').inert=true;
  $('arrival-continue').focus({preventScroll:true});
}
function finishArrival(){
  if($('world-arrival').hidden)return false;
  clearArrival();render();$('next-button').focus({preventScroll:true});return true;
}
function syncMusic() { music.configure(activeTrack(),prefs.sound,prefs.volume);effects.configure(activeTrack(),prefs.effects,prefs.effectVolume); }
function unlockAudio(){if(prefs.sound)void music.unlock();if(prefs.effects)void effects.unlock();}
function toggleSound(){const enabled=!(prefs.sound||prefs.effects);prefs.sound=prefs.effects=enabled;applyPrefs();unlockAudio();}
function finishCinematic(){
  if(!document.body.classList.contains('cinematic'))return false;
  if(!backdrop.holding)return true;
  watchedDoors.add(cinematicKey);backdrop.release();document.body.classList.remove('cinematic','cinematic-ready');render();return true;
}
function maybeCinematic(){
  if(document.body.classList.contains('cinematic'))return;
  const key=state.node+':'+state.name;
  if(!['threshold','door'].includes(state.node)||state.beat!==0||state.feedback||watchedDoors.has(key))return;
  cinematicKey=key;clearTyping();document.body.classList.add('cinematic');
  $('cinematic-continue').disabled=true;
  $('cinematic-continue').innerHTML='<span>Открывается дверь…</span>';backdrop.begin();
}
function stageSpeaker(speaker,heroEmotion){
  document.body.dataset.speaker=speaker==='hero'?'hero':speaker==='narrator'?'narrator':'npc';
}
// Read first, then open answers in the same compact frame on narrow screens.
function syncChoiceStep(){
  const hasChoices=!!state?.choices?.length&&!state.feedback;
  const choosing=hasChoices&&narrowDialogue.matches&&choiceStep;
  $('story-panel').classList.toggle('choosing',choosing);
  $('choices').hidden=!hasChoices||(narrowDialogue.matches&&!choiceStep);
  $('dialogue').hidden=choosing;
  $('choice-back').hidden=!choosing;
  $('speaker').textContent=choosing?'Твой ответ':speakerName(state.feedback?'narrator':state.line.speaker);
  $('speaker-mood').hidden=choosing;
  $('next-button').hidden=choosing||(!state.can_advance&&!hasChoices)||(hasChoices&&!narrowDialogue.matches);
  $('next-button').innerHTML=hasChoices&&narrowDialogue.matches?'Выбрать ответ <span>→</span>':'Далее <span>→</span>';
}
narrowDialogue.addEventListener('change',()=>{if(state&&screen==='game'&&state.kind!=='ending'&&!typing)syncChoiceStep();});
// Audio starts only after a real gesture and respects the player's saved mute choice.
document.addEventListener("pointerdown",unlockAudio,{capture:true});
document.addEventListener("keydown",unlockAudio,{capture:true});
const HERO_ART = {id:"hero",name:"Арти",image:"assets/characters/v4/hero-voyage-calm.png",atlas:true,columns:2,fullbody:true,frames:{neutral:0,warm:1,worried:0,resolve:0}};
const WORLD_DESIGN={
  'room-v2':['#d7b89b','31,26,39','✧','paper'], '0':['#b5d5c2','19,36,35','⌑','arch'],
  '2':['#e5a374','44,23,26','♨','cut'], '3':['#c1d397','24,36,29','❧','leaf'],
  '4':['#a6d6df','20,33,45','≈','arch'], '5':['#e8b09c','44,26,34','❀','leaf'],
  '6':['#c1bcf1','26,26,49','✧','cut'], '7':['#b7e2ee','21,36,47','❄','cut'],
  '8':['#d2bc94','35,29,39','◷','arch'], '9':['#e0c997','37,29,28','⌘','paper'],
  '10':['#c5c9ec','25,27,48','☾','arch'], '11':['#e2c89c','30,25,41','◇','cut']
};
function sceneDesign(){
  const world=screen==='home'?'11':state.bg, [accent,ink,sigil,shape]=WORLD_DESIGN[world]||WORLD_DESIGN['11'];
  document.body.dataset.world=world;document.body.dataset.frame=shape;
  camera.selectWorld(world);
  document.body.dataset.framing=state.framing||'medium';
  document.documentElement.style.setProperty('--world-accent',accent);
  document.documentElement.style.setProperty('--world-ink',ink);
  $('world-sigil').textContent=sigil;
}
const moods = {neutral:{frame:0,label:"Слушает"},warm:{frame:1,label:"Мягко улыбается"},worried:{frame:2,label:"Встревожена"},resolve:{frame:3,label:"Говорит уверенно"}};
const spriteImages=new Map();
function readySprite(url){
  if(spriteImages.has(url))return spriteImages.get(url);
  const image=new Image();
  const loaded=new Promise((resolve,reject)=>{
    image.onload=()=>{if(image.decode)image.decode().then(resolve,reject);else resolve();};
    image.onerror=reject;image.src=url;
  });
  spriteImages.set(url,loaded);
  loaded.catch(()=>spriteImages.delete(url));
  if(spriteImages.size>8)spriteImages.delete(spriteImages.keys().next().value);
  return loaded;
}

function setSprite(element, actor, emotion = "neutral") {
  const mood = moods[emotion] || moods.neutral;
  const columns=actor.columns||4, frame=actor.frames?.[emotion]??mood.frame;
  const spriteImage=actor.emotion_images?.[emotion]||actor.image;
  element.dataset.emotion=emotion;element.dataset.actor=actor.id;
  element.classList.toggle('fullbody',!!actor.fullbody);
  element.setAttribute('aria-label',`${actor.name}: ${mood.label.toLowerCase()}`);
  const signature = spriteImage + ":" + frame;
  if (element.dataset.requested === signature) return element.spriteReady || Promise.resolve(true);
  element.dataset.requested=signature;
  element.spriteReady=readySprite(asset(spriteImage)).then(()=>{
  if(element.dataset.requested!==signature)return false;
  const oldFront = element.querySelector(".sprite-front");
  const previous = oldFront ? {image:oldFront.style.backgroundImage,position:oldFront.style.backgroundPosition,size:oldFront.style.backgroundSize} : null;
  if(!oldFront)element.innerHTML = '<span class="sprite-layer sprite-back"></span><span class="sprite-layer sprite-front"></span>';
  const front = element.querySelector(".sprite-front"), back = element.querySelector(".sprite-back");
  for(const layer of [front,back])for(const animation of layer.getAnimations())animation.cancel();
  front.style.backgroundImage = `url("${asset(spriteImage)}")`;
  front.style.backgroundPosition = `${frame * 100/(columns-1)}% 0%`;
  front.style.backgroundSize=`${columns*100}% 100%`;
  back.style.backgroundSize=previous?.size||front.style.backgroundSize;
  back.style.backgroundImage = previous?.image || front.style.backgroundImage;
  back.style.backgroundPosition = previous?.position || front.style.backgroundPosition;
  element.classList.remove("switching");
  if (previous && prefs.characters && !reduced) {
    back.animate([{opacity:1},{opacity:0}],{duration:320,easing:'ease-in-out'});
    front.animate([{opacity:0},{opacity:1}],{duration:320,easing:'ease-in-out'});
  }
  element.dataset.signature = signature; element.dataset.emotion = emotion; element.dataset.actor = actor.id;
  element.setAttribute("role","img");
  return true;
  }).catch(()=>{if(element.dataset.requested===signature)delete element.dataset.requested;return false;});
  return element.spriteReady;
}

function talking(on) {
  clearTimeout(speechTimer);
  const speaker = state?.feedback ? "narrator" : state?.line?.speaker;
  $("hero-stage").classList.toggle("speaking", !!on && speaker === "hero" && !!prefs.characters);
  $("portrait-wrap").classList.toggle("speaking", !!on && speaker === state?.character?.id && !!prefs.characters);
  $("story-panel").classList.toggle("dialogue-speaking", !!on && speaker !== "narrator" && !!prefs.characters);
}

function toast(message) {
  clearTimeout(toastTimer); $("toast").textContent = message; $("toast").hidden = false;
  toastTimer = setTimeout(() => $("toast").hidden = true, 5500);
}

function applyPrefs() {
  document.body.classList.toggle('sidebar-collapsed',!prefs.sidebar);
  $('sidebar-toggle').setAttribute('aria-expanded',String(!!prefs.sidebar));
  $('sidebar-toggle').title=prefs.sidebar?'Свернуть боковую панель':'Развернуть боковую панель';
  $('chapter-sidebar').inert=!prefs.sidebar;
  document.body.classList.toggle("large-text", !!prefs.largeText);
  document.body.classList.toggle("still", !prefs.animation);
  document.body.classList.toggle("no-character-motion", !prefs.characters);
  document.documentElement.style.setProperty("--glass-opacity", prefs.glass);
  video.muted = true;
  syncMusic();
  $("sound-button").innerHTML = (prefs.sound||prefs.effects) ? "♫" : '♫<span class="sound-off">/</span>';
  $("sound-button").setAttribute("aria-label", (prefs.sound||prefs.effects) ? "Выключить звук" : "Включить звук");
  $("sound-button").title = (prefs.sound||prefs.effects) ? "Выключить звук" : "Включить звук";
  backdrop.configure(prefs.animation,document.hidden);
  if (!prefs.typewriter) finishTyping();
  try { localStorage.setItem("between-worlds-settings", JSON.stringify(prefs)); } catch (_) {}
}

function background(id, media = null) {
  if(currentBackground===id)return;currentBackground=id;
  const portraitDoor=id==='11'&&window.matchMedia('(orientation: portrait)').matches;
  const poster=portraitDoor?asset('assets/backgrounds/door-portrait.jpg'):media?asset(media.poster):asset(`assets/backgrounds/${id}.jpg`);
  document.body.dataset.doorPortrait=String(portraitDoor);
  const source=id==='11'?asset(portraitDoor?'assets/video/mobile/11.mp4':'assets/video/door-once.mp4'):compactDevice.matches&&/^\d+$/.test(id)?asset(`assets/video/mobile/${id}.mp4`):id==='10'?asset('assets/video/moon-clean.mp4'):media?(media.video?asset(media.video):null):asset(`materials/${id}.mp4`);
  backdrop.select(id,poster,source);
}

async function refresh() {
  const response = await fetch("api/state", {cache:"no-store"});
  if (!response.ok) throw new Error("Python не отвечает. Проверь окно запуска игры.");
  const data = await response.json(); state = data.state; token = data.token;
}

async function action(actionName, extra = {}) {
  if (busy || !state) return false;
  const previousView=state, previousNode = state.node;
  busy = true; $("save-status").textContent = "◈ Сохраняем…";
  try {
    const response = await fetch("api/action", {method:"POST", headers:{"Content-Type":"application/json", "X-Game-Token":token},
      body:JSON.stringify({action:actionName, revision:state.revision, ...extra})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие.");
    state = data.state;
    if (state.node !== previousNode) window.scrollTo(0,0);
    if (actionName === "new" || actionName === "load") { watchedDoors.clear();dialogueKey=null;screen = "game"; closeModal(); window.scrollTo(0,0); }
    if(actionName==='new'||actionName==='load')clearArrival();
    render();
    const arrival=actionName==='advance'?arrivalFor(previousView,state):null;
    if(arrival)showArrival(arrival);
    return true;
  } catch (error) {
    toast(error.message || "Потеряна связь с Python. Проверь окно запуска и попробуй снова.");
    try { await refresh(); render(); } catch (_) { $("save-status").textContent = "◈ Нет связи с Python · последний прогресс сохранён"; }
    return false;
  } finally { busy = false; }
}

function clearTyping() { if (typing) clearTimeout(typing); typing = null; afterTyping = null; talking(false); }
function finishTyping() {
  if (!typing && !afterTyping) return;
  clearTimeout(typing); typing = null; $("dialogue").textContent = fullText;
  talking(false);
  const callback = afterTyping; afterTyping = null; if (callback) callback();
}
function typeText(text, callback, immediate = false) {
  text=I18n.t(text);
  clearTyping(); fullText = text;
  talking(true);
  if (!prefs.typewriter || immediate) { $("dialogue").textContent = text; callback(); speechTimer=setTimeout(()=>talking(false),1400); return; }
  $("dialogue").textContent = ""; let n = 0; afterTyping = callback;
  // Accessible text appears as one complete announcement, without hundreds of live updates.
  $("dialogue").setAttribute("aria-label", text);
  $("dialogue").setAttribute("aria-live", "off");
  const letters=Array.from(text);
  const reveal=()=>{
    const letter=letters[n++];
    $("dialogue").textContent=letters.slice(0,n).join('');
    if(n>=letters.length){finishTyping();return;}
    const pause=/[.!?…]/.test(letter)?260:/[,;:—]/.test(letter)?120:0;
    typing=setTimeout(reveal,1000/prefs.textSpeed+pause);
  };
  typing=setTimeout(reveal,1000/prefs.textSpeed);
}

function render(options = {}) {
  if (!state) return;
  I18n.context(state);
  const key=JSON.stringify([state.node,state.beat,state.feedback,state.look]);
  if(key!==dialogueKey){choiceStep=false;dialogueKey=key;$('story-panel').scrollTop=0;$('dialogue').scrollTop=0;$('choices').scrollTop=0;}
  sceneDesign();
  clearTyping();
  $("clue-count").textContent = state.started ? state.clues.length : 0;
  $("continue-button").hidden = !state.started;
  $("start-button").innerHTML = state.started ? 'Новая история <span>↗</span>' : 'Начать историю <span>↗</span>';
  $("home").hidden = screen !== "home";
  $("game").hidden = screen !== "game" || state.kind === "ending";
  $("ending").hidden = screen !== "game" || state.kind !== "ending";
  document.body.classList.toggle("playing", screen === "game" && state.kind !== "ending");
  document.body.classList.toggle("ending-screen", screen === "game" && state.kind === "ending");
  $("save-status").textContent = "◈ Прогресс сохранён";
  setSprite($("home-hero"), state.hero || HERO_ART, "neutral");
  syncMusic();
  if (screen === "home") { background("3"); return; }
  background(state.bg, state.media);
  if (state.kind === "ending") { renderEnding(); return; }
  $("story-panel").classList.toggle("puzzle-panel", state.kind === "puzzle" && !state.feedback);
  $("chapter-label").textContent = `ГЛАВА ${String(state.chapter + 1).padStart(2,"0")} / 06`;
  $("chapter-name").textContent = state.chapters[state.chapter];
  $("chapter-progress").innerHTML = state.chapters.map((_,i) => `<span class="${i <= state.chapter ? "done" : ""}"></span>`).join("");
  $("courage").textContent = state.stats.courage; $("insight").textContent = state.stats.insight;
  $("shard-icons").innerHTML = ["❧", "♨", "☾"].map((x,i) => `<span class="${i < state.stats.shards ? "found" : ""}" title="${["Лист","Пламя","Луна"][i]}">${x}</span>`).join("");
  $("portrait-wrap").hidden = !state.character;
  const hero = state.hero || {...HERO_ART,name:state.name};
  const heroEmotion = state.hero_emotion || "neutral";
  setSprite($("hero-sprite"),hero,heroEmotion);
  $("hero-stage").classList.toggle("solo",!state.character);
  $("hero-mood").textContent = hero.name + " · " + moods[heroEmotion].label.toLowerCase();
  if (state.character) {
    $("portrait").hidden=!!state.character.atlas;
    $("npc-sprite").hidden=!state.character.atlas;
    if(state.character.atlas) setSprite($("npc-sprite"),state.character,state.character.emotion || "neutral");
    else {$("portrait").src = asset(state.character.image); $("portrait").alt = state.character.name;}
    $("portrait-name").textContent = state.character.name; $("portrait-title").textContent = state.character.title;
    $("npc-mood").textContent = state.character.name + " · " + moods[state.character.emotion || "neutral"].label.toLowerCase();
  }
  const feedback = state.feedback;
  $('story-panel').classList.remove('choosing');$('dialogue').hidden=false;$('choice-back').hidden=true;$('speaker-mood').hidden=false;
  const speaker = feedback ? "narrator" : state.line.speaker;
  stageSpeaker(speaker,heroEmotion);
  $("speaker").textContent = speakerName(speaker);
  $("hero-stage").classList.toggle("active",speaker === "hero" || !state.character);
  $("portrait-wrap").classList.toggle("active",speaker === state.character?.id);
  const speakingMood = speaker === "hero" ? heroEmotion : state.character?.emotion || "neutral";
  $("speaker-mood").textContent = speaker !== "narrator" && speakingMood !== "neutral" ? moods[speakingMood].label.toLowerCase() : "";
  $("beat-count").textContent = feedback ? "ТВОЙ ВЫБОР" : state.kind === "quiz" ? `ИСПЫТАНИЕ ${state.stats.shards + 1} / 3` : `${String(state.beat + 1).padStart(2,"0")} / ${String(state.beats).padStart(2,"0")}`;
  $("choices").innerHTML = ""; $("choices").hidden = true; $("puzzle").hidden = true;
  $("effect-list").innerHTML = "";
  $("next-button").hidden = false; $("next-button").innerHTML = 'Показать текст <span>→</span>';
  typeText(feedback ? feedback.text : state.line.text, () => {
    $("dialogue").setAttribute("aria-live", "polite");
    $("dialogue").removeAttribute("aria-label");
    $("next-button").hidden = !state.can_advance;
    $("next-button").innerHTML = 'Далее <span>→</span>';
    if (feedback) $("effect-list").innerHTML = feedback.effects.map(x => `<span class="effect">✧ ${escapeHTML(x)}</span>`).join("");
    if (state.choices?.length) {
      $("choices").hidden = false;
      $("choices").innerHTML = state.choices.map(c => `<button class="choice" data-choice="${c.id}" ${!c.available ? 'disabled' : ''}><span class="choice-number">${c.available ? c.id+1 : "◇"}</span><span class="choice-copy"><strong>${escapeHTML(c.text)}</strong>${c.label ? `<small>${c.available ? "" : "Нужно: "}${escapeHTML(c.label)}</small>` : ""}</span><span class="choice-arrow">${c.available ? "→" : ""}</span></button>`).join("");
      document.querySelectorAll("[data-choice]").forEach(button => button.onclick = () => action("choose", {choice:Number(button.dataset.choice)}));
    }
    if (state.kind === "puzzle" && !feedback) { selectedRunes = []; renderPuzzle(); }
    syncChoiceStep();
  }, !!options.instant);
  maybeCinematic();
}

function speakerName(id) {
  if (id === "hero") return state.name;
  if (id === "narrator") return "Твоя история";
  return state.characters.find(c => c.id === id)?.name || id;
}

function renderPuzzle() {
  $("puzzle").hidden = false;
  const symbols = state.symbols;
  $("puzzle").innerHTML = `<p class="puzzle-instruction">Выбери три символа по порядку. Нажми на заполненное гнездо, чтобы убрать символ.</p><div class="rune-slots">${[0,1,2].map((_,i) => `${i ? '<span class="rune-arrow">→</span>' : ''}<button class="rune-slot ${selectedRunes[i] ? 'filled' : ''}" data-slot="${i}" aria-label="Гнездо ${i+1}${selectedRunes[i] ? ': '+symbols.find(s => s.id===selectedRunes[i]).name : ': пусто'}">${symbols.find(s => s.id===selectedRunes[i])?.icon || ""}</button>`).join("")}</div><div class="rune-options">${symbols.map(s => `<button class="rune" data-rune="${s.id}" ${selectedRunes.includes(s.id) || selectedRunes.length===3 ? "disabled" : ""}><span>${s.icon}</span><small>${s.name}</small></button>`).join("")}</div><div class="rune-actions"><button class="button primary" id="check-runes" ${selectedRunes.length!==3 ? 'disabled' : ''}>Повернуть ключ →</button><button class="text-button" id="rune-hint">Подсказки в дневнике</button><button class="text-button" id="skip-runes">Попросить Саэль о помощи</button></div>`;
  document.querySelectorAll("[data-rune]").forEach(b => b.onclick = () => { if (selectedRunes.length < 3 && !selectedRunes.includes(b.dataset.rune)) { selectedRunes.push(b.dataset.rune); renderPuzzle(); } });
  document.querySelectorAll("[data-slot]").forEach(b => b.onclick = () => { selectedRunes.splice(Number(b.dataset.slot),1); renderPuzzle(); });
  $("check-runes").onclick = () => action("puzzle", {symbols:[...selectedRunes]});
  $("rune-hint").onclick = () => journal("clues");
  $("skip-runes").onclick = () => confirmModal("Помощь Саэль", "Саэль откроет дверь. Ты сможешь завершить историю, но для тайной концовки нужно разгадать механизм самой. Попытки не ограничены.", "Попросить о помощи", () => {closeModal(); action("skip_puzzle");});
}

function renderEnding() {
  const ending = state.ending;
  $("ending").innerHTML = `<article class="ending-card"><div class="ending-sigil">${state.node === "ending_bridge" ? "☾" : state.node === "ending_stay" ? "♡" : "✧"}</div><p class="eyebrow">${escapeHTML(ending.subtitle)}</p><h1>${escapeHTML(ending.title)}</h1><p class="ending-text">${escapeHTML(ending.text)}</p>${ending.afterword ? `<p class="ending-afterword">${escapeHTML(ending.afterword)}</p>` : ""}<div class="ending-stats"><div><strong>${state.stats.courage}</strong><span>СМЕЛОСТЬ</span></div><div><strong>${state.stats.insight}</strong><span>ЧУТКОСТЬ</span></div><div><strong>${state.stats.wisdom} / 3</strong><span>ИСПЫТАНИЯ</span></div></div><div class="ending-actions"><button class="button primary" id="again">Другая история ↗</button><button class="button secondary" id="ending-journal">Мой дневник</button></div><p class="ending-hint">${state.node === "ending_bridge" ? "Ты соединила два мира. Но у этой истории есть и другие пути." : "В истории четыре концовки. Чтобы соединить миры, ответь на три вопроса и разгадай лунный механизм."}</p><button class="text-button" id="ending-home">Вернуться в главное меню</button></article>`;
  $("again").onclick = newGame; $("ending-journal").onclick = () => journal(); $("ending-home").onclick = home;
}

function openModal(title, kicker, html) {
  if (!$("modal").open) modalReturnFocus = document.activeElement;
  $("modal-title").textContent = title; $("modal-kicker").textContent = kicker;
  $("modal-content").innerHTML = html;
  if (!$("modal").open) $("modal").showModal();
  $("modal").scrollTop = 0;
}
function closeModal() { $("modal").close(); if (modalReturnFocus?.isConnected) modalReturnFocus.focus(); }
function confirmModal(title, text, button, callback) {
  openModal(title, "ТВОЯ ИСТОРИЯ", `<p class="modal-intro">${escapeHTML(text)}</p><div class="form-footer"><button class="button secondary" id="cancel-confirm">Отмена</button><button class="button primary" id="confirm-action">${escapeHTML(button)}</button></div>`);
  $("cancel-confirm").onclick = closeModal; $("confirm-action").onclick = callback;
}

function newGame() {
  openModal("Как тебя зовут?", "ПО ТУ СТОРОНУ ДВЕРИ", `<p class="modal-intro">Всё начнётся с обычного вечера и отражения, которое опоздает на секунду. Слушай хранительниц, выбирай, кому довериться, и собирай подсказки. Здесь нет таймера: можно не торопиться.</p>${state.started ? '<p class="notice">Новая история заменит автосохранение. Ручные сохранения останутся. Если хочешь вернуться к текущему моменту, сначала сохрани его в одну из ячеек.</p>' : ''}<form id="name-form"><label class="form-label" for="hero-name">Имя героини</label><input class="name-input" id="hero-name" maxlength="24" required autocomplete="off" value="Арти"><p class="modal-intro">Около 40–60 минут · пролог и 6 глав · 4 финала</p><div class="form-footer"><button class="button primary" type="submit">Открыть дверь <span>↗</span></button></div></form>`);
  $("hero-name").value=I18n.language==='ru'?'Арти':'Arty';
  $("hero-name").focus(); $("hero-name").select();
  $("name-form").onsubmit = e => {e.preventDefault(); action("new", {name:$("hero-name").value});};
}

function journal(tab = "clues", preview = false) {
  const tabs = `<div class="tabs"><button class="tab ${tab==='clues'?'active':''}" id="tab-clues">Подсказки</button><button class="tab ${tab==='characters'?'active':''}" id="tab-characters">Персонажи</button><button class="tab ${tab==='history'?'active':''}" id="tab-history">Диалоги</button><button class="tab" id="tab-hero">Твоя героиня</button></div>`;
  let content = "";
  if (tab === "clues") content = state.started ? state.clues.map((clue,i) => `<article class="clue"><span class="tiny-label">ЗАПИСЬ ${String(i+1).padStart(2,"0")}</span><h3>${escapeHTML(clue.title)}</h3><p>${escapeHTML(clue.text)}</p></article>`).join("") : '<p class="empty">Пока здесь чистые страницы.<br>Подсказки появятся, когда начнётся твоя история.</p>';
  if (tab === "characters") content = `<p class="modal-intro">${preview ? "Десять людей по ту сторону двери. У каждого — ремесло, мечта и жизнь за пределами твоего путешествия." : "Каждая встреча оставляет след. Выборы меняют доверие; близость к Верес, Марен или Саэль определяет финал «Там, где тебя ждут»."}</p><div class="character-grid">${state.characters.map(c => `<article class="character-card ${!c.met && !preview ? 'unmet' : ''}"><div class="character-image">${c.atlas ? `<div class="sprite" data-portrait="${c.id}"></div>` : `<img src="${asset(c.image)}" alt="${escapeHTML(c.name)}" loading="lazy">`}</div><strong>${escapeHTML(c.name)}</strong><p>${escapeHTML(c.title)}</p><p class="cast-bio">${escapeHTML(c.bio||'')}</p><small>${!c.met ? "Вы ещё не знакомы" : "♡ "+c.bond+" · "+(c.bond>=3 ? "Близость" : c.bond>=1 ? "Доверие" : "Знакомство")}</small>${c.atlas ? `<button class="text-button" data-expression="${c.id}">Рассмотреть ↗</button>` : ''}</article>`).join("")}</div>`;
  if (tab === "history") content = state.history.length ? state.history.map(line => `<div class="history-line"><strong>${escapeHTML(speakerName(line.speaker))}</strong><p>${escapeHTML(line.text)}</p></div>`).join("") : '<p class="empty">Ваш первый разговор ещё впереди.</p>';
  openModal(preview ? "По ту сторону двери" : "Твой дневник", "ПАМЯТЬ О ПУТЕШЕСТВИИ", tabs + content);
  $("tab-clues").onclick = () => journal("clues",preview); $("tab-characters").onclick = () => journal("characters",preview); $("tab-history").onclick = () => journal("history",preview);
  $("tab-hero").onclick = () => portraitPreview(state.hero || HERO_ART);
  document.querySelectorAll("[data-portrait]").forEach(e=>setSprite(e,state.characters.find(c=>c.id===e.dataset.portrait)));
  document.querySelectorAll("[data-expression]").forEach(e=>e.onclick=()=>portraitPreview(state.characters.find(c=>c.id===e.dataset.expression)));
}

function portraitPreview(actor) {
  if(actor.id==='hero'){wardrobe();return;}
  openModal(actor.id === "hero" ? "Твоя героиня" : actor.name, "ЖИВОЕ ОТРАЖЕНИЕ", `<div class="portrait-lab"><div id="portrait-preview" class="sprite"></div></div><div class="expression-options">${Object.entries(moods).map(([key,mood])=>`<button class="button secondary" data-mood="${key}" aria-pressed="${key==='neutral'}">${escapeHTML(mood.label)}</button>`).join("")}</div><p class="portrait-caption-text">Во время разговоров выражение меняется вместе с настроением реплики.</p><button id="back-to-cast" class="text-button">← К персонажам</button>`);
  setSprite($("portrait-preview"),actor);
  document.querySelectorAll("[data-mood]").forEach(b=>{if(actor.columns===2&&!['neutral','warm'].includes(b.dataset.mood))b.remove();else b.onclick=()=>{setSprite($("portrait-preview"),actor,b.dataset.mood);document.querySelectorAll("[data-mood]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));};});
  document.querySelector('.portrait-caption-text').textContent=(actor.bio||'')+' Два нарисованных выражения: спокойствие и улыбка.';
  $("back-to-cast").onclick=()=>journal("characters",true);
}

function wardrobe(selected=state.look||'voyage') {
  const looks=state.looks||[], look=looks.find(x=>x.id===selected);
  if(!look){toast('Перезапусти игру, чтобы открыть новый гардероб.');return;}
  openModal('Твой гардероб','КАК ТЫ ЧУВСТВУЕШЬ СЕБЯ СЕГОДНЯ',`<div class="wardrobe-layout"><div class="wardrobe-mirror"><div id="wardrobe-hero" class="sprite"></div><button id="wardrobe-zoom" class="text-button" aria-pressed="false">Рассмотреть лицо ↗</button></div><div class="wardrobe-options"><p class="modal-intro">Четыре цельных образа: одежда, причёска и лёгкий макияж. Можно переодеться в любой момент — твой выбор сохранится вместе с историей.</p>${looks.map(x=>`<button class="look-choice ${x.id===selected?'selected':''}" data-look="${x.id}" aria-pressed="${x.id===selected}"><strong>${escapeHTML(x.name)}</strong><span>${escapeHTML(x.detail)}</span>${state.look===x.id?'<small>Сейчас на тебе</small>':''}</button>`).join('')}<button id="wear-look" class="button primary" ${state.look===selected?'disabled':''}>Надеть образ ↗</button><p class="portrait-caption-text">Гардероб свободный: внешность не меняет отношения и не закрывает сюжетные пути.</p></div></div>`);
  const dressed={...state.hero,...look,name:state.hero.name};
  setSprite($('wardrobe-hero'),dressed,'neutral');
  const emotions=document.createElement('div');emotions.className='wardrobe-emotions';
  emotions.innerHTML=Object.entries(moods).map(([key,mood])=>`<button data-wardrobe-mood="${key}" aria-pressed="${key==='neutral'}">${mood.label}</button>`).join('');
  document.querySelector('.wardrobe-options').prepend(emotions);
  emotions.querySelectorAll('button').forEach(button=>button.onclick=()=>{setSprite($('wardrobe-hero'),dressed,button.dataset.wardrobeMood);emotions.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
  $('wardrobe-zoom').onclick=()=>{const zoom=document.querySelector('.wardrobe-mirror').classList.toggle('zoomed');$('wardrobe-zoom').setAttribute('aria-pressed',String(zoom));$('wardrobe-zoom').textContent=zoom?'Показать весь рост ↙':'Рассмотреть лицо ↗';};
  document.querySelectorAll('[data-look]').forEach(b=>b.onclick=()=>wardrobe(b.dataset.look));
  $('wear-look').onclick=async()=>{if(await action('dress',{look:selected})){wardrobe(selected);toast('Образ сохранён');}};
}

function saves() {
  openModal("Сохранения", "МОЖНО ВЕРНУТЬСЯ", `<p class="modal-intro">Автосохранение обновляется после каждой реплики и выбора. Три ручные ячейки помогут исследовать другие пути.</p>${state.slots.map(s => `<article class="slot"><div><h3>${s.slot==='auto' ? "Автосохранение" : "Ячейка 0"+s.slot}</h3>${s.corrupt ? '<p>Файл повреждён. Можно перезаписать ячейку.</p>' : s.exists ? `<p>${escapeHTML(s.name)} · ${escapeHTML(s.location)}</p><p>${new Date(s.saved_at).toLocaleString(I18n.language, {day:"2-digit",month:"long",hour:"2-digit",minute:"2-digit"})}</p>` : '<p>Пока пусто</p>'}</div><div class="slot-actions">${s.slot!=='auto' ? `<button class="button secondary small-button" data-save="${s.slot}" ${!state.started?'disabled':''}>Сохранить</button>` : ''}<button class="button secondary small-button" data-load="${s.slot}" ${!s.exists || s.corrupt?'disabled':''}>Загрузить</button></div></article>`).join("")}`);
  document.querySelectorAll("[data-save]").forEach(b => b.onclick = () => {
    const slot = b.dataset.save;
    const save = async () => { if (await action("save", {slot})) { saves(); toast("История сохранена в ячейку " + slot); } };
    if (state.slots.find(s=>s.slot===slot).exists) confirmModal("Перезаписать ячейку?", "В этой ячейке уже есть история. Её заменит текущий момент.", "Сохранить", save); else save();
  });
  document.querySelectorAll("[data-load]").forEach(b => b.onclick = () => {
    const slot = b.dataset.load;
    confirmModal("Вернуться к сохранению?", "Текущий момент автосохранения будет заменён выбранным. Ручные ячейки останутся.", "Загрузить", () => action("load", {slot}));
  });
}

function settings() {
  const toggles = [
    ["sound","Фоновая музыка","Своя инструментальная тема для каждого мира. Плавные переходы без обрыва."],
    ["effects","Звуковые эффекты миров","Тихие шорохи, ветер и вода. В огненном мире — редкий далёкий зов дракона."],
    ["animation","Живые фоны","Видео и светящиеся частицы."],
    ["characters","Движения персонажей","Лёгкое дыхание, акцент на говорящем и плавная смена эмоций."],
    ["typewriter","Постепенное появление текста","Нажми на текст или пробел, чтобы увидеть всю реплику."],
    ["largeText","Крупный текст","Увеличить реплики и варианты ответа."],
  ];
  openModal("В твоём ритме", "НАСТРОЙКИ", toggles.map(([key,title,description])=>`<label class="setting"><span><strong>${title}</strong><p>${description}</p></span><input id="pref-${key}" type="checkbox" ${prefs[key]?'checked':''}></label>`).join("") + `<label class="setting"><span><strong>Громкость музыки</strong></span><input id="pref-volume" type="range" min="0" max="100" value="${prefs.volume*100}" aria-label="Громкость музыки"></label><label class="setting"><span><strong>Громкость эффектов</strong></span><input id="pref-effectVolume" type="range" min="0" max="100" value="${prefs.effectVolume*100}" aria-label="Громкость эффектов"></label><label class="setting"><span><strong>Плотность стекла · <span id="glass-value">${Math.round(prefs.glass*100)}%</span></strong><p>Меньше — прозрачнее. Больше — контрастнее текст.</p></span><input id="pref-glass" type="range" min="40" max="95" value="${prefs.glass*100}" aria-label="Плотность стекла"></label><p class="modal-intro">Пробел / Enter — дальше · 1–4 — выбор ответа<br>J — дневник · S — сохранения · Esc — закрыть окно<br>F — полноэкранный режим · M — звук</p>`);
  const languageSetting=document.createElement('label');languageSetting.className='setting language-setting';
  languageSetting.innerHTML=`<span><strong>Язык</strong><p>Язык истории и интерфейса. Прогресс сохранится.</p></span><select id="language-select" aria-label="${escapeHTML(I18n.t('Язык'))}" data-no-i18n>${Object.entries(I18n.languages).map(([code,label])=>`<option value="${code}" ${code===I18n.language?'selected':''}>${label}</option>`).join('')}</select>`;
  $('modal-content').prepend(languageSetting);
  $('language-select').onchange=async e=>{
    const select=e.target;select.disabled=true;
    try{if(await I18n.change(select.value)){
      const runes=[...selectedRunes],instant=!typing;clearTyping();render({instant});
      if(screen==='game'&&state.kind==='puzzle'&&!state.feedback&&!typing){selectedRunes=runes;renderPuzzle();}
      settings();$('language-select').focus({preventScroll:true});
    }}
    catch{select.value=I18n.language;toast('Не удалось загрузить язык. Попробуй ещё раз.');}
    finally{select.disabled=false;}
  };
  const nowPlaying = document.createElement("p"); nowPlaying.className="modal-intro";
  nowPlaying.textContent=I18n.t("Тема мира:")+' «'+I18n.t(WORLD_TRACKS[activeTrack()])+'» · '+I18n.t("инструментальная музыка без вокала");
  $("modal-content").prepend(nowPlaying);
  const speedSetting=document.createElement('label');speedSetting.className='setting';
  speedSetting.innerHTML=`<span><strong>Скорость текста · <span id="text-speed-value">${prefs.textSpeed}</span> симв/с</strong><p>Влево — медленнее. На знаках препинания текст делает паузы.</p></span><input id="pref-textSpeed" type="range" min="8" max="40" step="1" value="${prefs.textSpeed}" aria-label="Скорость текста">`;
  $('pref-volume').closest('.setting').before(speedSetting);
  $('pref-textSpeed').oninput=e=>{prefs.textSpeed=Number(e.target.value);$('text-speed-value').textContent=prefs.textSpeed;applyPrefs();};
  for (const [key] of toggles) $("pref-"+key).onchange = e => {prefs[key]=e.target.checked; applyPrefs();unlockAudio();};
  $("pref-effectVolume").oninput=e=>{prefs.effectVolume=Number(e.target.value)/100;applyPrefs();};
  $("pref-volume").oninput = e => {prefs.volume=Number(e.target.value)/100; applyPrefs();};
  $("pref-glass").oninput=e=>{prefs.glass=Number(e.target.value)/100;$("glass-value").textContent=Math.round(prefs.glass*100)+"%";applyPrefs();};
}

function home() { clearArrival();backdrop.release();document.body.classList.remove("cinematic","cinematic-ready");screen="home"; document.body.classList.remove('scenery-mode');$('scenery-toggle').setAttribute('aria-pressed','false');closeModal(); render(); window.scrollTo(0,0); }
function next() { if(finishArrival()||finishCinematic())return; if (screen!=="game" || $("modal").open || busy || document.body.classList.contains("scenery-mode")) return; if (typing) finishTyping(); else if(narrowDialogue.matches&&state.choices?.length&&!state.feedback&&!choiceStep){choiceStep=true;syncChoiceStep();$('choices').querySelector('button:not(:disabled)')?.focus({preventScroll:true});}else if (state.can_advance) action("advance"); }
$("brand").onclick=home; $("start-button").onclick=newGame; $("continue-button").onclick=()=>{screen="game";render();window.scrollTo(0,0);};
$("characters-button").onclick=()=>journal("characters",true); $("journal-button").onclick=()=>journal();
$("history-button").onclick=()=>journal("history"); $("saves-button").onclick=saves; $("settings-button").onclick=settings;
$("sound-button").onclick=toggleSound;
$("cinematic-continue").onclick=finishCinematic;
$('arrival-continue').onclick=finishArrival;
$("next-button").onclick=next; $("dialogue").onclick=next; $("close-modal").onclick=closeModal;
$('choice-back').onclick=()=>{choiceStep=false;syncChoiceStep();$('next-button').focus({preventScroll:true});};
$('wardrobe-button').onclick=()=>wardrobe();
$('sidebar-toggle').onclick=()=>{prefs.sidebar=!prefs.sidebar;applyPrefs();};
$('scenery-toggle').onclick=()=>{const hidden=document.body.classList.toggle('scenery-mode');$('scenery-toggle').setAttribute('aria-pressed',String(hidden));$('scenery-toggle').innerHTML=hidden?'↩ <span>Вернуться к истории</span>':'◇ <span>Осмотреть мир</span>';};
$("modal").addEventListener("click", e=>{if(e.target===$("modal")){const r=$("modal").getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
document.addEventListener("keydown", e=>{
  if(!state || $("modal").open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.altKey || e.metaKey) return;
  const key=e.key.toLowerCase();
  if(!$('world-arrival').hidden){if(key===' '||key==='enter'){e.preventDefault();finishArrival();}return;}
  if ((key===" " || key==="enter") && e.target.tagName!=="BUTTON") {e.preventDefault();next();}
  else if (key==="j" || key==="о") journal();
  else if (key==="s" || key==="ы") saves();
  else if (key==="m" || key==="ь") toggleSound();
  else if (key==="f" || key==="а") {if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});else document.documentElement.requestFullscreen().catch(()=>toast("Полноэкранный режим недоступен в этом окне."));}
  else if (/^[1-4]$/.test(key) && screen==="game" && !typing && !busy && !$('choices').hidden && !document.body.classList.contains("scenery-mode") && !document.body.classList.contains("cinematic")) {const c=state.choices?.[Number(key)-1];if(c?.available)action("choose",{choice:c.id});}
});
document.addEventListener("visibilitychange",()=>{void music.visibility(document.hidden);effects.visibility(document.hidden);backdrop.configure(prefs.animation,document.hidden);});
Promise.all([I18n.init(),refresh()]).then(()=>{render();applyPrefs();I18n.dom();$("loading").hidden=true;if(state.warning)toast(state.warning);}).catch(()=>{
  document.documentElement.dataset.languageReady='true';
  $("loading").innerHTML='<img class="brand-logo" src="assets/branding/icon-key-192.png" alt=""><p>Не удалось открыть историю.</p><p>Запусти «Запустить игру.bat» и обнови эту страницу.</p><button id="retry" class="button primary">Попробовать снова</button>';
  $("retry").onclick=()=>location.reload();
});
