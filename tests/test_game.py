"""Проверка всех веток, сохранений и HTTP-воспроизведения видео. Без зависимостей."""
from copy import deepcopy
import json
from pathlib import Path
import uuid
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from engine import Game, GameError, fresh_state
from main import make_server, ROOT
from story import NODES, ENDINGS, CHARACTERS, PUZZLE_ANSWER
from story_expansion import HERO
from story_edition3 import LOOKS, NEW_FLAGS


class TestDirectory:
    """Рабочая папка: не зависит от разрешений системного TEMP на Windows."""
    def __init__(self):
        root = ROOT / ".work"
        root.mkdir(exist_ok=True)
        self.path = root / ("test-" + uuid.uuid4().hex)
        self.path.mkdir()
        self.name = str(self.path)

    def cleanup(self):
        assert self.path.resolve().parent == (ROOT / ".work").resolve()
        for file in self.path.iterdir():
            file.unlink()
        self.path.rmdir()


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = TestDirectory()
        self.addCleanup(self.temp.cleanup)
        self.game = Game(self.temp.name)

    def act(self, action, **kwargs):
        return self.game.act({"action": action, "revision": self.game.revision, **kwargs})

    def last_line(self):
        while self.game.view().get("can_advance"):
            self.act("advance")

    def play_to_door(self, correct=True, solve=True, choices=None):
        self.act("new", name="Арти")
        choices = choices or {}
        quiz_answers = {"forest_quiz": 0, "garden_quiz": 1, "moon_quiz": 2}
        guard = 0
        while self.game.state["node"] != "door":
            guard += 1
            self.assertLess(guard, 300)
            view = self.game.view()
            if view["can_advance"]:
                self.act("advance")
            elif view["kind"] == "puzzle":
                if solve:
                    self.act("puzzle", symbols=PUZZLE_ANSWER)
                else:
                    self.act("skip_puzzle")
            else:
                node = view["node"]
                index = choices.get(node, 0)
                if node in quiz_answers:
                    index = quiz_answers[node] if correct else (quiz_answers[node] + 1) % 3
                if node not in choices and not view["choices"][index]["available"]:
                    index = next(c["id"] for c in view["choices"] if c["available"])
                self.act("choose", choice=index)
        self.last_line()

    def test_all_story_edges_and_assets_exist(self):
        for name, node in NODES.items():
            if node["bg"].isdigit():
                self.assertTrue((ROOT / "materials" / f"{node['bg']}.mp4").is_file(), name)
                self.assertTrue((ROOT / "assets/backgrounds" / f"{node['bg']}.jpg").is_file(), name)
            else:
                self.assertTrue((ROOT / "assets/backgrounds" / f"{node['bg']}.png").is_file(), name)
            for c in node["choices"]:
                self.assertIn(c["next"], NODES.keys() | ENDINGS.keys())
        for char in CHARACTERS.values():
            self.assertTrue((ROOT / char["image"]).is_file())
        self.assertTrue((ROOT / HERO["image"]).is_file())

    def test_every_world_has_a_music_track(self):
        music_dir = ROOT / "assets/music"
        manifest = json.loads((music_dir / "manifest.json").read_text(encoding="utf-8"))
        by_world = {track["world"]: track for track in manifest}
        worlds = {node["bg"] for node in NODES.values()} | {node["bg"] for node in ENDINGS.values()}
        self.assertEqual(worlds, set(by_world))
        for world in worlds:
            self.assertGreater((ROOT / by_world[world]["file"]).stat().st_size, 100_000)
            self.assertGreater(by_world[world]["seconds"], 45)
            self.assertLess(by_world[world]["peak"], .99)

    def test_all_endings_reachable(self):
        for index, ending in enumerate(ENDINGS):
            with self.subTest(ending=ending):
                self.play_to_door(choices={"lady": 1, "stars": 1, "ice": 1, "eternity": 1, "moon": 1})
                self.assertTrue(self.game.view()["choices"][index]["available"])
                self.act("choose", choice=index)
                self.act("advance")
                self.assertEqual(self.game.state["node"], ending)
                self.assertEqual(self.game.view()["kind"], "ending")

    def test_mistakes_and_assistance_still_allow_finishing(self):
        self.play_to_door(correct=False, solve=False)
        self.assertEqual(self.game.state["stats"]["wisdom"], 0)
        self.assertEqual(self.game.state["stats"]["shards"], 3)
        self.assertFalse(self.game.view()["choices"][2]["available"])
        with self.assertRaises(GameError):
            self.act("choose", choice=2)
        self.act("choose", choice=0)
        self.act("advance")
        self.assertEqual(self.game.state["node"], "ending_home")

    def test_optional_routes_and_companion(self):
        self.play_to_door(choices={"forest": 1, "garden": 1, "garden_secret": 0, "moon": 1,"possible_tomorrow":1})
        self.assertIn("river", self.game.state["clues"])
        self.assertIn("lovely", self.game.state["met"])
        self.act("choose", choice=1)
        self.act("advance")
        self.assertEqual(self.game.view()["character"]["id"], "merry")
        self.assertIn("Марен", self.game.view()["ending"]["text"])

    def test_save_reload_feedback_and_atomic_effects(self):
        self.act("new", name="<Моё имя>")
        self.last_line()
        self.act("choose", choice=0)
        saved = deepcopy(self.game.state)
        self.act("save", slot="1")
        self.act("advance")
        self.act("load", slot="1")
        self.assertEqual(self.game.state, saved)
        self.assertEqual(Game(self.temp.name).state, saved)
        with self.assertRaises(GameError):
            self.act("choose", choice=0)
        self.assertEqual(self.game.state, saved)

    def test_puzzle_retry_and_save_mid_feedback(self):
        self.act("new", name="Арти")
        self.game._enter("mechanism")
        self.act("puzzle", symbols=["star", "moon", "leaf"])
        self.assertFalse(self.game.state["puzzle_solved"])
        self.act("save", slot="2")
        self.act("advance")
        self.act("puzzle", symbols=PUZZLE_ANSWER)
        self.assertTrue(self.game.state["puzzle_solved"])
        self.act("load", slot="2")
        self.assertEqual(self.game.state["feedback"]["next"], "mechanism")
        self.act("advance")
        self.assertEqual(self.game.state["puzzle_attempts"], 1)
        self.act("puzzle", symbols=PUZZLE_ANSWER)
        self.act("advance")
        self.assertEqual(self.game.state["node"], "last_reflection")

    def test_stale_and_invalid_actions_do_not_mutate(self):
        self.act("new", name="Арти")
        before = deepcopy(self.game.state)
        for payload in ({"action": "advance", "revision": -1},
                        {"action": "choose", "choice": 999, "revision": self.game.revision},
                        {"action": "puzzle", "symbols": PUZZLE_ANSWER, "revision": self.game.revision}):
            with self.assertRaises(GameError):
                self.game.act(payload)
            self.assertEqual(self.game.state, before)

    def test_corrupt_save_is_reported(self):
        Path(self.temp.name, "slot_auto.json").write_text('{"broken":', encoding="utf-8")
        game = Game(self.temp.name)
        self.assertTrue(game.warning)
        self.assertFalse(game.state["started"])
        self.assertTrue(game.slots()[0]["corrupt"])

    def test_low_courage_locks_wanderer(self):
        self.play_to_door(choices={"threshold":1,"lady":0,"fiery":1,"forest":0,"tree":1,"garden":0,"stars":0,"ice":0,"eternity":0,"moon":0})
        self.assertFalse(self.game.view()["choices"][3]["available"])

    def test_every_branch_can_reach_an_ending(self):
        completed=set()
        def walk(node, seen):
            if node in ENDINGS:
                return
            self.assertNotIn(node, seen, "Непреднамеренный цикл сценария")
            if node in completed:return
            targets = [c["next"] for c in NODES[node]["choices"]]
            if node == "mechanism":
                targets = ["last_reflection"]
            self.assertTrue(targets)
            for target in targets:
                walk(target, seen | {node})
            completed.add(node)
        walk("ordinary_evening", set())

    def test_v1_save_migrates_without_restarting_scene(self):
        legacy = fresh_state("Из первой версии")
        legacy.pop("flags")
        legacy.pop("edition")
        legacy.update(node="forest", beat=1, started=True, clues=["threshold", "forest"])
        Path(self.temp.name, "slot_auto.json").write_text(json.dumps({"state": legacy}), encoding="utf-8")
        restored = Game(self.temp.name)
        self.assertEqual(restored.state["node"], "forest")
        self.assertEqual(restored.state["beat"], 1)
        self.assertEqual(restored.state["flags"], [])
        self.assertEqual(restored.state["edition"], 1)
        self.assertIn("Каждый день", restored.view()["line"]["text"])
        restored.act({"action": "advance", "revision": 0})
        self.assertEqual(restored.state["beat"], 2)

    def test_keepsake_changes_later_dialogue_and_history(self):
        self.act("new", name="Арти")
        self.last_line()
        self.act("choose", choice=0)
        self.assertIn("kept_sketch", self.game.state["flags"])
        self.game._enter("forest_echo")
        self.assertIn("рисунок", self.game.view()["line"]["text"])
        self.assertIn("рисунок", self.game.state["history"][-1]["text"])
        self.game.state["flags"] = ["kept_pendant"]
        self.game._enter("forest_echo")
        self.assertIn("кулону", self.game.view()["line"]["text"])
        self.assertIn("кулону", self.game.state["history"][-1]["text"])

    def test_elian_release_requires_insight_and_changes_epilogue(self):
        self.act("new", name="Арти")
        self.game._enter("echo_chamber")
        self.last_line()
        self.assertFalse(self.game.view()["choices"][0]["available"])
        with self.assertRaises(GameError):
            self.act("choose", choice=0)
        self.game.state["stats"]["insight"] = 4
        self.act("choose", choice=0)
        self.assertIn("echo_released", self.game.state["flags"])
        self.act("save", slot="3")
        self.game._enter("ending_home")
        self.assertIn("Элиан", self.game.view()["ending"]["afterword"])
        self.act("load", slot="3")
        self.assertIn("echo_released", self.game.state["flags"])

    def test_expressions_follow_lines_and_survive_save(self):
        self.act("new", name="Арти")
        self.game._enter("tree")
        self.assertEqual(self.game.view()["character"]["emotion"], "neutral")
        self.act("advance")
        self.assertEqual(self.game.view()["character"]["emotion"], "warm")
        self.assertEqual(self.game.view()["hero_emotion"], "warm")
        self.assertEqual(self.game.state["history"][-1].keys(), {"speaker", "text"})
        self.act("save", slot="1")
        self.act("advance")
        self.act("load", slot="1")
        self.assertEqual(self.game.view()["hero_emotion"], "warm")

    def test_wardrobe_persists_without_changing_story(self):
        self.act('new',name='Арти')
        before=deepcopy(self.game.state)
        self.act('dress',look='moon')
        self.assertEqual(self.game.state,{**before,'look':'moon'})
        self.assertEqual(Game(self.temp.name).view()['look'],'moon')
        self.act('save',slot='1')
        self.act('dress',look='woodland')
        self.act('load',slot='1')
        self.assertEqual(self.game.view()['hero']['image'],LOOKS['moon']['image'])
        with self.assertRaises(GameError):self.act('dress',look='../bad')
        self.act('new',name='Арти')
        self.assertEqual(self.game.state['look'],'moon')

    def test_v2_save_gets_default_look(self):
        old=fresh_state();old.pop('look');old['edition']=2
        restored=Game.validate(old)
        self.assertEqual(restored['look'],'voyage')
        self.assertEqual(restored['node'],old['node'])

    def test_staying_has_three_concrete_lives(self):
        for index,who in enumerate(('loony','merry','moony')):
            self.play_to_door(choices={'possible_tomorrow':index})
            self.act('choose',choice=1);self.act('advance')
            view=self.game.view()
            self.assertEqual(view['character']['id'],who)
            self.assertIn('письмо',view['ending']['text'].lower())
            self.assertGreater(len(view['ending']['text']),300)

    def test_original_cast_fullbody_and_scene_direction(self):
        self.assertEqual(len(CHARACTERS),10)
        for char in CHARACTERS.values():
            self.assertIn('/v3/',char['image']);self.assertTrue(char['fullbody'])
            self.assertEqual(char['columns'],2);self.assertTrue(char['bio'])
        for node in NODES.values():
            self.assertIn(node['framing'],('full','medium','close'))
        for look in LOOKS.values():self.assertTrue((ROOT/look['image']).is_file())

    def test_four_hero_expressions_for_every_look(self):
        for key,look in LOOKS.items():
            self.act('dress',look=key)
            hero=self.game.view()['hero']
            self.assertEqual(set(hero['emotion_images']),{'neutral','warm','worried','resolve'})
            frames={(hero['emotion_images'][emotion],hero['frames'][emotion]) for emotion in hero['emotion_images']}
            self.assertEqual(len(frames),4)
            for path,_ in frames:self.assertTrue((ROOT/path).is_file(),path)

    def test_save_retries_temporary_windows_file_lock(self):
        from unittest.mock import patch
        original=Path.replace
        attempts=[]
        def briefly_locked(source,target):
            attempts.append(source)
            if len(attempts)<3:raise PermissionError('temporary file lock')
            return original(source,target)
        with patch.object(Path,'replace',briefly_locked),patch('engine.time.sleep'):
            self.act('new',name='Арти')
        self.assertEqual(len(attempts),3)
        self.assertTrue(Game(self.temp.name).state['started'])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = TestDirectory()
        self.server = make_server(save_dir=self.temp.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.temp.cleanup()

    def request(self, path, **kwargs):
        return urlopen(Request(self.base + path, **kwargs), timeout=5)

    def test_boot_and_video_ranges(self):
        with self.request("/") as response:
            self.assertIn("Между мирами", response.read().decode())
        with self.request("/materials/0.mp4", headers={"Range":"bytes=10-29"}) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(len(response.read()), 20)
            self.assertTrue(response.headers["Content-Range"].startswith("bytes 10-29/"))
        with self.request("/materials/0.mp4", headers={"Range":"bytes=-12"}) as response:
            self.assertEqual(len(response.read()), 12)
        with self.assertRaises(HTTPError) as error:
            self.request("/materials/0.mp4", headers={"Range":"bytes=9999999999-"})
        self.assertEqual(error.exception.code, 416)

    def test_api_and_private_files(self):
        with self.request("/api/state") as response:
            data = json.load(response)
        payload = json.dumps({"action":"new","name":"Тест","revision":data["state"]["revision"]}).encode()
        with self.request("/api/action", data=payload, headers={"X-Game-Token":data["token"],"Content-Type":"application/json"}) as response:
            self.assertTrue(json.load(response)["state"]["started"])
        for path in ("/engine.py", "/saves/slot_auto.json", "/assets/%2e%2e/engine.py"):
            with self.assertRaises(HTTPError):
                self.request(path)
        with self.assertRaises(HTTPError) as error:
            self.request("/api/action", data=payload, headers={"Content-Type":"application/json"})
        self.assertEqual(error.exception.code, 403)

    def test_lan_host_allowlist_and_origin(self):
        from unittest.mock import patch
        with patch('main.local_addresses',return_value={'127.0.0.1','localhost','192.168.1.23'}):
            lan=make_server(save_dir=self.temp.name,lan=True)
        try:
            self.assertEqual(lan.server_address[0],'0.0.0.0')
            self.assertIn(f'192.168.1.23:{lan.server_port}',lan.allowed_hosts)
            self.assertNotIn(f'attacker.example:{lan.server_port}',lan.allowed_hosts)
        finally:lan.server_close()
        with self.assertRaises(HTTPError) as error:
            self.request('/api/state',headers={'Host':'attacker.example'})
        self.assertEqual(error.exception.code,403)


if __name__ == "__main__":
    unittest.main()
