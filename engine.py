"""Движок новеллы: весь прогресс, условия и сохранения обрабатываются Python."""
from copy import deepcopy
import json
from pathlib import Path
from datetime import datetime, timezone
from threading import RLock
import time

from story import CHARACTERS, CHAPTERS, CLUES, NODES, ENDINGS, PUZZLE_ANSWER, PUZZLE_SYMBOLS
from story_expansion import HERO, EMOTIONS, FLAGS
from story_edition3 import LOOKS, STAY_LIVES, rewrite_names

STATS = ("courage", "insight", "wisdom", "shards")
STAT_NAMES = {"courage": "Смелость", "insight": "Чуткость", "wisdom": "Верных ответов", "shards": "Осколки"}


class GameError(ValueError):
    pass


def fresh_state(name="Арти"):
    return {"schema": 1, "edition": 3, "look": "voyage", "name": name, "node": "ordinary_evening", "beat": 0,
            "stats": dict.fromkeys(STATS, 0), "bonds": dict.fromkeys(CHARACTERS, 0),
            "clues": [], "met": [], "history": [], "feedback": None, "flags": [],
            "puzzle_solved": False, "puzzle_attempts": 0, "started": False}


class Game:
    def __init__(self, save_dir):
        self.save_dir = Path(save_dir)
        self.save_dir.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.revision = 0
        self.warning = ""
        self.state = fresh_state()
        if self._path("auto").exists():
            try:
                self.state = self._read("auto")
            except (OSError, ValueError, KeyError, TypeError):
                self.warning = "Автосохранение не удалось прочитать. Можно начать новую игру или загрузить ручное сохранение."

    def _path(self, slot):
        if slot not in ("auto", "1", "2", "3"):
            raise GameError("Неизвестная ячейка сохранения.")
        return self.save_dir / f"slot_{slot}.json"

    def _write(self, slot, state):
        path = self._path(slot)
        temp = path.with_suffix(".tmp")
        data = {"saved_at": datetime.now(timezone.utc).isoformat(), "state": state}
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        # Windows indexing/antivirus can briefly hold the destination after a save.
        # Keep the old file intact and retry the atomic replacement, never truncate it.
        for attempt in range(6):
            try:
                temp.replace(path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(.025 * (attempt + 1))

    @staticmethod
    def validate(state):
        if not isinstance(state, dict) or state.get("schema") != 1:
            raise GameError("Неподдерживаемая версия сохранения.")
        state = deepcopy(state)
        # Сохранения первой версии продолжаются с прежней реплики.
        state.setdefault("flags", [])
        state.setdefault("edition", 1)
        state.setdefault("look", "voyage")
        if not isinstance(state["look"], str) or state["look"] not in LOOKS:
            raise GameError("Неизвестный образ героини.")
        flags = state["flags"]
        if (not isinstance(flags, list) or any(not isinstance(x, str) or x not in FLAGS for x in flags)
                or len(flags) != len(set(flags)) or type(state["edition"]) is not int or state["edition"] not in (1, 2, 3)):
            raise GameError("Повреждены сюжетные решения.")
        if not isinstance(state.get("name"), str) or not 1 <= len(state["name"]) <= 24:
            raise GameError("Повреждено имя в сохранении.")
        node = state.get("node")
        if node not in NODES and node not in ENDINGS:
            raise GameError("Неизвестная сцена в сохранении.")
        beat = state.get("beat")
        if type(beat) is not int or not 0 <= beat < len(NODES.get(node, {"lines": [0]})["lines"]):
            raise GameError("Повреждён номер реплики.")
        for field, keys, limit in (("stats", STATS, 30), ("bonds", CHARACTERS, 10)):
            values = state.get(field)
            if not isinstance(values, dict) or set(values) != set(keys):
                raise GameError("Повреждены характеристики.")
            if any(type(v) is not int or not 0 <= v <= limit for v in values.values()):
                raise GameError("Недопустимые характеристики.")
        if state["stats"]["wisdom"] > 3 or state["stats"]["shards"] > 3:
            raise GameError("Недопустимое число осколков или ответов.")
        for field, valid in (("clues", CLUES), ("met", CHARACTERS)):
            value = state.get(field)
            if not isinstance(value, list) or any(not isinstance(x, str) or x not in valid for x in value):
                raise GameError("Повреждён дневник.")
            if len(value) != len(set(value)):
                raise GameError("Повторные записи в дневнике.")
        for field in ("started", "puzzle_solved"):
            if type(state.get(field)) is not bool:
                raise GameError("Повреждён прогресс.")
        if type(state.get("puzzle_attempts")) is not int or not 0 <= state["puzzle_attempts"] <= 9999:
            raise GameError("Повреждён прогресс механизма.")
        history = state.get("history")
        if not isinstance(history, list) or len(history) > 400 or any(
                not isinstance(x, dict) or set(x) != {"speaker", "text"} or
                not all(isinstance(v, str) and len(v) < 3000 for v in x.values()) for x in history):
            raise GameError("Повреждена история диалогов.")
        feedback = state.get("feedback")
        if feedback is not None:
            if not isinstance(feedback, dict) or set(feedback) != {"text", "next", "effects"}:
                raise GameError("Повреждён результат выбора.")
            if feedback["next"] not in NODES and feedback["next"] not in ENDINGS:
                raise GameError("Повреждён переход.")
            if not isinstance(feedback["text"], str) or len(feedback["text"]) > 3000:
                raise GameError("Повреждена реплика.")
            if not isinstance(feedback["effects"], list) or len(feedback["effects"]) > 10 or any(
                    not isinstance(x, str) or len(x) > 200 for x in feedback["effects"]):
                raise GameError("Повреждены результаты выбора.")
        return deepcopy(state)

    def _read(self, slot):
        path = self._path(slot)
        if not path.exists():
            raise GameError("В этой ячейке ещё нет сохранения.")
        if path.stat().st_size > 1_000_000:
            raise GameError("Файл сохранения слишком большой.")
        try:
            return self.validate(json.loads(path.read_text(encoding="utf-8"))["state"])
        except (KeyError, TypeError, ValueError) as exc:
            raise GameError("Сохранение повреждено или создано другой версией игры.") from exc

    def slots(self):
        result = []
        for slot in ("auto", "1", "2", "3"):
            entry = {"slot": slot, "exists": self._path(slot).exists()}
            if entry["exists"]:
                try:
                    state = self._read(slot)
                    entry.update(name=state["name"], chapter=self._chapter(state),
                                 location=self._location(state),
                                 saved_at=datetime.fromtimestamp(self._path(slot).stat().st_mtime, timezone.utc).isoformat())
                except (OSError, ValueError):
                    entry["corrupt"] = True
            result.append(entry)
        return result

    def _chapter(self, state):
        return NODES[state["node"]]["chapter"] if state["node"] in NODES else 5

    def _location(self, state):
        return NODES[state["node"]]["location"] if state["node"] in NODES else ENDINGS[state["node"]]["title"]

    def _log(self, speaker, text, when=None, alternate=None, **_):
        if when and when not in self.state["flags"] and isinstance(alternate, str):
            text = alternate
        self.state["history"].append({"speaker": speaker, "text": text.replace("{name}", self.state["name"])})
        self.state["history"] = self.state["history"][-400:]

    def _enter(self, node):
        self.state.update(node=node, beat=0, feedback=None)
        if node in NODES:
            data = NODES[node]
            if data.get("clue") and data["clue"] not in self.state["clues"]:
                self.state["clues"].append(data["clue"])
            char = data.get("character")
            if char and char not in self.state["met"]:
                self.state["met"].append(char)
            self._log(**data["lines"][0])

    def _available(self, choice):
        for key, value in choice.get("requires", {}).items():
            actual = self.state.get(key, self.state["stats"].get(key, 0))
            if actual < value:
                return False
        return True

    def view(self):
        with self.lock:
            state = self.state
            result = {"revision": self.revision, "edition": 3, "name": state["name"], "started": state["started"],
                      "hero": {**HERO, **LOOKS[state['look']], "name":state["name"]}, "emotions": EMOTIONS,
                      "look":state['look'], "looks":[dict(id=k,**v) for k,v in LOOKS.items()],
                      "stats": deepcopy(state["stats"]), "chapter": self._chapter(state), "chapters": CHAPTERS,
                      "location": self._location(state), "node": state["node"], "warning": self.warning,
                      "clues": [dict(id=x, **CLUES[x]) for x in state["clues"]],
                      "characters": [dict(id=k, **v, met=k in state["met"], bond=state["bonds"][k]) for k, v in CHARACTERS.items()],
                      "history": rewrite_names(deepcopy(state["history"])), "slots": self.slots(),
                      "feedback": rewrite_names(deepcopy(state["feedback"])), "puzzle_solved": state["puzzle_solved"]}
            if state["node"] in ENDINGS:
                ending = deepcopy(ENDINGS[state["node"]])
                # Среди равных отношений отдаём предпочтение личным веткам.
                candidates = ["loony", "merry", "moony"]
                companion = max(candidates, key=lambda k: state["bonds"][k])
                for flag,who in [('stay_forest','loony'),('stay_garden','merry'),('stay_beacon','moony')]:
                    if flag in state['flags']: companion=who
                ending["text"] = ending["text"].replace("{companion}", CHARACTERS[companion]["name"])
                if state['node']=='ending_stay':
                    ending['bg'],ending['text']=STAY_LIVES[companion]
                ending["afterword"] = ending.get("after_echo", "") if "echo_released" in state["flags"] else (
                    "В дневнике остался голос Элиан. Её история ещё не закончена, но теперь она больше не забыта."
                    if "echo_remembered" in state["flags"] else "")
                result.update(kind="ending", ending=ending, bg=ending["bg"],
                              character=dict(id=companion, **CHARACTERS[companion]) if state["node"] == "ending_stay" else None)
            else:
                node = NODES[state["node"]]
                char = node.get("character")
                line = deepcopy(node["lines"][state["beat"]])
                if line.get("when") and line["when"] not in state["flags"]:
                    line["text"] = line["alternate"]
                line["text"] = line["text"].replace("{name}", state["name"])
                emotion, hero_emotion = line.get("emotion", "neutral"), line.get("hero_emotion", "neutral")
                if state["feedback"]:
                    effects = state["feedback"]["effects"]
                    if any("доверие" in effect for effect in effects):
                        emotion = hero_emotion = "warm"
                    elif node.get("kind") == "quiz":
                        emotion = hero_emotion = "warm" if any("Верных ответов" in effect for effect in effects) else "worried"
                    else:
                        hero_emotion = "resolve"
                last = state["beat"] == len(node["lines"]) - 1
                choices = [{"id": i, "text": c["text"], "label": c["label"], "available": self._available(c)}
                           for i, c in enumerate(node["choices"])] if last and not state["feedback"] else []
                result.update(kind=node.get("kind", "story"), bg=node["bg"], line=line,
                              framing=node.get('framing','medium'),
                              beat=state["beat"], beats=len(node["lines"]), choices=choices,
                              character=dict(id=char, **CHARACTERS[char], emotion=emotion) if char else None,
                              hero_emotion=hero_emotion,
                              can_advance=bool(state["feedback"]) or not last)
                if node.get("kind") == "puzzle":
                    result.update(symbols=PUZZLE_SYMBOLS, puzzle_attempts=state["puzzle_attempts"])
            result["media"] = {"poster": f"assets/backgrounds/{result['bg']}.jpg",
                               "video": f"materials/{result['bg']}.mp4" if result["bg"].isdigit() else None}
            if result["bg"] == "room-v2":
                result["media"]["poster"] = "assets/backgrounds/room-v2.png"
            if result['bg'] in ('10','11'):
                result['media']['video'] = 'assets/video/' + ('moon-clean.mp4' if result['bg']=='10' else 'door-once.mp4')
            return result

    def act(self, payload):
        with self.lock:
            if payload.get("revision") != self.revision:
                raise GameError("Прогресс изменился в другом окне. Обновляем экран — повтори действие.")
            action = payload.get("action")
            before = deepcopy(self.state)
            try:
                if action == "new":
                    name = payload.get("name", "Арти")
                    if not isinstance(name, str):
                        raise GameError("Введи имя героини.")
                    name = " ".join(name.split())
                    if not 1 <= len(name) <= 24 or any(ord(x) < 32 for x in name):
                        raise GameError("Имя должно содержать от 1 до 24 символов.")
                    previous_look=self.state['look']
                    self.state = fresh_state(name)
                    self.state['look']=previous_look
                    self.state["started"] = True
                    self._enter("ordinary_evening")
                elif action == "dress":
                    look=payload.get('look')
                    if not isinstance(look,str) or look not in LOOKS:
                        raise GameError("Выбери один из образов гардероба.")
                    self.state['look']=look
                elif action == "load":
                    self.state = self._read(str(payload.get("slot")))
                elif action == "save":
                    if not self.state["started"]:
                        raise GameError("Сначала начни историю.")
                    slot = str(payload.get("slot"))
                    if slot not in ("1", "2", "3"):
                        raise GameError("Выбери одну из трёх ручных ячеек.")
                    self._write(slot, self.state)
                elif self.state["node"] in ENDINGS or not self.state["started"]:
                    raise GameError("Начни новую историю или загрузи сохранение.")
                elif action == "advance":
                    if self.state["feedback"]:
                        self._enter(self.state["feedback"]["next"])
                    else:
                        node = NODES[self.state["node"]]
                        if self.state["beat"] >= len(node["lines"]) - 1:
                            raise GameError("Сначала сделай выбор.")
                        self.state["beat"] += 1
                        self._log(**node["lines"][self.state["beat"]])
                elif action == "choose":
                    node = NODES[self.state["node"]]
                    index = payload.get("choice")
                    if self.state["feedback"] or self.state["beat"] != len(node["lines"]) - 1:
                        raise GameError("Сначала дочитай реплику.")
                    if type(index) is not int or not 0 <= index < len(node["choices"]):
                        raise GameError("Такого выбора нет.")
                    selected = node["choices"][index]
                    if not self._available(selected):
                        raise GameError("Этот путь пока недоступен.")
                    effects = []
                    for key, amount in selected["effects"].items():
                        if key.startswith("bond_"):
                            who = key[5:]
                            self.state["bonds"][who] += amount
                            effects.append(f"{CHARACTERS[who]['name']}: доверие +{amount}")
                        else:
                            self.state["stats"][key] += amount
                            effects.append(f"{STAT_NAMES[key]} +{amount}")
                    if selected["clue"] and selected["clue"] not in self.state["clues"]:
                        self.state["clues"].append(selected["clue"])
                    for flag in selected.get("set_flags", []):
                        if flag not in self.state["flags"]:
                            self.state["flags"].append(flag)
                    self._log("hero", selected["text"])
                    self._log("narrator", selected["reply"])
                    self.state["feedback"] = {"text": selected["reply"], "next": selected["next"], "effects": effects}
                elif action in ("puzzle", "skip_puzzle"):
                    if self.state["node"] != "mechanism" or self.state["feedback"]:
                        raise GameError("Механизм сейчас недоступен.")
                    if action == "puzzle":
                        symbols = payload.get("symbols")
                        valid_ids = {x["id"] for x in PUZZLE_SYMBOLS}
                        if not isinstance(symbols, list) or len(symbols) != 3 or any(
                                not isinstance(x, str) or x not in valid_ids for x in symbols) or len(set(symbols)) != 3:
                            raise GameError("Выбери три разных символа.")
                        self.state["puzzle_attempts"] = min(self.state["puzzle_attempts"] + 1, 9999)
                        if symbols != PUZZLE_ANSWER:
                            self.state["feedback"] = {"text": "Механизм тихо щёлкает и замирает. Начни с живого, затем вспомни тепло и отражённый свет. Подсказки сохранены в дневнике.", "next": "mechanism", "effects": ["Можно попробовать снова"]}
                        else:
                            self.state["puzzle_solved"] = True
                            self.state["feedback"] = {"text": "Лист. Пламя. Луна. Три кольца совпадают, и свет пробегает по ключу. Дверь между мирами открыта.", "next": "last_reflection", "effects": ["Лунный механизм разгадан"]}
                    else:
                        self.state["feedback"] = {"text": "Саэль поворачивает кольца за тебя. «Помощь — тоже часть пути». Дверь открыта, но тайну соединения миров ещё предстоит понять.", "next": "last_reflection", "effects": ["Саэль помогла открыть дверь"]}
                    self._log("narrator", self.state["feedback"]["text"])
                else:
                    raise GameError("Неизвестное действие.")
                self.validate(self.state)
                self._write("auto", self.state)
            except Exception:
                self.state = before
                raise
            self.revision += 1
            self.warning = ""
            return self.view()
