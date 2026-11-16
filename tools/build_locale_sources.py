"""Collect canonical story and UI copy. Never read player saves or photographs."""
import ast
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import engine
from story_edition3 import rewrite_names
strings=set()
def add(value):
    if isinstance(value,str):
        value=' '.join(value.split())
        if re.search('[А-Яа-яЁё]',value): strings.add(value)
    elif isinstance(value,dict):
        for v in value.values():add(v)
    elif isinstance(value,(list,tuple)):
        for v in value:add(v)
class Copy(HTMLParser):
    def handle_data(self,data):add(data)
    def handle_starttag(self,tag,attrs):
        for key,value in attrs:
            if key in ('title','aria-label','placeholder','alt'):add(value)
for value in [engine.NODES,engine.CHARACTERS,engine.CHAPTERS,engine.CLUES,engine.ENDINGS,engine.HERO,engine.LOOKS,engine.STAY_LIVES,engine.PUZZLE_SYMBOLS,engine.EMOTIONS,engine.STAT_NAMES]:add(rewrite_names(value))
for value in json.loads((ROOT/'.work/locales/ui-raw.json').read_text(encoding='utf8')):
    if '<' in value:Copy().feed(value)
    else:add(value)
Copy().feed((ROOT/'web/index.html').read_text(encoding='utf8'))
tree=ast.parse((ROOT/'engine.py').read_text(encoding='utf8'))
for node in ast.walk(tree):
    if isinstance(node,ast.Constant) and isinstance(node.value,str):add(rewrite_names(node.value))
for value in re.findall(r"'([^'\n]*[А-Яа-яЁё][^'\n]*)'",(ROOT/'hosting/api.php').read_text(encoding='utf8')):add(value)
add(['Язык','Язык истории и интерфейса. Прогресс сохранится.','Готовим перевод…','Не удалось загрузить язык. Попробуй ещё раз.'])
# Labels assembled across template expressions need independent dictionary entries.
add(['Гнездо','пусто','Плотность стекла','Скорость текста','Подсказки','Персонажи','Диалоги','Рассмотреть ↗','Надеть образ ↗','Повернуть ключ →','Ячейка','Тема мира:','инструментальная музыка без вокала'])
# The hosting build replaces desktop-specific connection errors.
add(['Игра временно недоступна. Обнови страницу через несколько секунд.','Потеряна связь с сервером. Проверь интернет и попробуй снова.','◈ Нет связи с сервером · последний прогресс сохранён','Проверь подключение к интернету и попробуй ещё раз.','Для игры нужно включить JavaScript в браузере. Сюжет и сохранения обрабатывает сервер игры.'])
out=ROOT/'web/locales';out.mkdir(exist_ok=True)
(out/'ru.json').write_text(json.dumps({s:s for s in sorted(strings)},ensure_ascii=False,indent=2),encoding='utf8')
print(len(strings),'strings;',sum(len(s.split()) for s in strings),'words')
