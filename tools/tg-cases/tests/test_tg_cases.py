"""Tests for tg_cases.py (stdlib unittest, no network, no Whisper models).

    python3 -m unittest discover -s tools/tg-cases/tests -v

Outputs go to $TG_CASES_TEST_DIR (default: <system temp>/tg-cases-test). PyAV decode tests run
in-process when `av` and `numpy` are importable, else with $TG_CASES_AV_PYTHON or
$TG_CASES_TEST_DIR/venv/bin/python, else they are skipped. The Python 3.9 test uses `python3.9`
from PATH or from `uv python find 3.9`.
"""
from __future__ import annotations

import ast
import contextlib
import io
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent / "tg_cases.py"
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import make_fixture as mf  # noqa: E402
import tg_cases as tc  # noqa: E402

BASE = Path(os.environ.get("TG_CASES_TEST_DIR") or Path(tempfile.gettempdir()) / "tg-cases-test").resolve()
FX = {}

MARINA, JOHN, PETYA, KATYA, ANNA = "1000000101", "1000000102", "1000000103", "1000000105", "1000000106"
SASHA1, SASHA2, IGOR, MAMA = "1000000107", "1000000108", "1000000109", "1000000110"
TIXU, SCHOOL, LANDING = "2000000201", "2000000202", "2000000203"
BOT = "1000000199"
ME_ID = "user1000000001"


def setUpModule():
    BASE.mkdir(parents=True, exist_ok=True)
    FX.update(mf.build_all(BASE / "fixture"))


def fresh(name: str) -> Path:
    d = BASE / "runs" / name
    shutil.rmtree(d, ignore_errors=True)
    d.parent.mkdir(parents=True, exist_ok=True)
    return d


def run_main(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = tc.main([str(a) for a in argv])
    return code, out.getvalue(), err.getvalue()


def run_cli(*argv, python=None, timeout=300):
    return subprocess.run([python or sys.executable, str(TOOL)] + [str(a) for a in argv],
                          capture_output=True, text=True, timeout=timeout)


def read(p: Path) -> str:
    return Path(p).read_text(encoding="utf-8")


# ----------------------------------------------------------------------------- parsing

class TestParsing(unittest.TestCase):
    def test_full_export(self):
        exp = tc.load_export(str(FX["full"]))
        self.assertEqual(exp.kinds["full"], 1)
        self.assertEqual(exp.me_id, ME_ID)
        self.assertEqual(exp.me_name, "Алексей Пример")
        keys = {c.key for c in exp.kept}
        self.assertEqual(keys, {MARINA, JOHN, PETYA, KATYA, ANNA, SASHA1, SASHA2, IGOR, MAMA, TIXU, SCHOOL, LANDING})
        skipped = {c.type for c in exp.chats if not c.kept}
        self.assertEqual(skipped, {"saved_messages", "bot_chat", "public_channel", "public_supergroup", "private_channel"})
        names = {c.key: c.name for c in exp.chats}
        self.assertEqual(names[LANDING], "🚀 Лендинг / Тильда")
        self.assertEqual(names[SASHA1], names[SASHA2])

    def test_result_json_path_and_parent_folder(self):
        a = tc.load_export(str(FX["full"] / "result.json"))
        b = tc.load_export(str(FX["full"].parent))           # folder that contains DataExport_...
        self.assertEqual(len(a.chats), 17)
        self.assertEqual({c.key for c in a.chats}, {c.key for c in b.chats})

    def test_single_chat_export(self):
        exp = tc.load_export(str(FX["single"]))
        self.assertEqual(exp.kinds["single"], 1)
        self.assertEqual(len(exp.chats), 1)
        chat = exp.chats[0]
        self.assertEqual((chat.key, chat.type, chat.name), ("1000000111", "personal_chat", "Дарья"))
        items = tc.voice_items(chat)
        self.assertEqual([i.kind for i in items], ["voice", "round"])
        self.assertTrue(all(i.path and i.path.is_file() for i in items))
        self.assertTrue(items[0].rel.startswith("voice_messages/"))

    def test_parent_folder_with_two_single_exports(self):
        exp = tc.load_export(str(FX["multi"]))
        self.assertEqual(exp.kinds["single"], 2)
        self.assertEqual({c.key for c in exp.chats}, {"1000000112", "2000000204"})

    def test_html_export_is_explained(self):
        with self.assertRaises(tc.UserError) as cm:
            tc.load_export(str(FX["html_only"]))
        self.assertIn("Машиночитаемый JSON", str(cm.exception))
        with self.assertRaises(tc.UserError):
            tc.load_export(str(FX["html_only"] / "ChatExport_2026-10-11" / "messages.html"))

    def test_missing_and_foreign_paths(self):
        with self.assertRaises(tc.UserError) as cm:
            tc.load_export(str(BASE / "no-such-folder"))
        self.assertIn("Не нашёл", str(cm.exception))
        d = fresh("foreign")
        d.mkdir()
        (d / "result.json").write_text('{"foo": 1}', encoding="utf-8")
        with self.assertRaises(tc.UserError):
            tc.load_export(str(d))
        (d / "result.json").write_text('{"name": "x", "type": "personal_chat", "id": 1, "messages": [',
                                       encoding="utf-8")
        with self.assertRaises(tc.UserError) as cm:
            tc.load_export(str(d / "result.json"))
        self.assertIn("JSON", str(cm.exception))

    def test_macos_folder_access_denied(self):
        with mock.patch.object(tc.os, "listdir", side_effect=PermissionError(1, "Operation not permitted")):
            with self.assertRaises(tc.UserError) as cm:
                tc.load_export(str(FX["full"]))
        self.assertIn("Конфиденциальность", str(cm.exception))

    def test_quoted_and_escaped_paths(self):
        p = str(FX["single"])
        self.assertEqual(tc.resolve_input_path(f"'{p}'"), FX["single"].resolve())
        self.assertEqual(tc.resolve_input_path(f"  {p}  "), FX["single"].resolve())

    def test_control_character_written_as_backslash_x(self):
        raw = read(FX["full"] / "result.json")
        self.assertIn("\\x07", raw)                          # invalid JSON, as Telegram writes it
        exp = tc.load_export(str(FX["full"]))
        chat = exp.by_key()[MARINA]
        self.assertIn("Обязательно\x07 напишу", tc.message_text(chat.messages[-1]))

    def test_text_shapes_and_entities(self):
        self.assertEqual(tc.flatten_text("plain"), "plain")
        self.assertEqual(tc.flatten_text(""), "")
        mixed = ["Смотри ", {"type": "text_link", "text": "статью", "href": "https://example.com/a"}, ", ",
                 {"type": "mention_name", "text": "Ivan", "user_id": 1}, " ",
                 {"type": "link", "text": "https://example.com/b"}]
        self.assertEqual(tc.flatten_text(mixed), "Смотри статью (https://example.com/a), Ivan https://example.com/b")
        self.assertEqual(tc.flatten_text(mixed, links=False), "Смотри статью, Ivan https://example.com/b")
        m = {"text": mixed, "text_entities": []}
        self.assertEqual(tc.message_links(m), ["https://example.com/a", "https://example.com/b"])
        self.assertEqual(tc.message_text({"rich_message": {"blocks": [{"text": "Богатый"}, {"text": "текст"}]}}),
                         "Богатый текст")

    def test_duplicate_exports_keep_longest(self):
        d = fresh("dupes")
        shutil.copytree(FX["single"], d / "ChatExport_2026-10-11")
        shutil.copytree(FX["single"], d / "ChatExport_2026-10-11 (1)")
        p = d / "ChatExport_2026-10-11" / "result.json"
        data = json.loads(read(p))
        data["messages"] = data["messages"][:2]
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        exp = tc.load_export(str(d))
        self.assertEqual(len(exp.chats), 1)
        self.assertEqual(exp.duplicates, 1)
        self.assertEqual(len(exp.chats[0].messages), 5)

    def test_sparse_real_world_messages_do_not_crash(self):
        d = fresh("sparse")
        d.mkdir()
        chat = {"name": None, "type": "private_group", "id": 77, "messages": [
            {"id": 1, "type": "message", "date": "2024-01-01T10:00:00", "from": None, "text": "ТЗ и оплата 5 000 ₽"},
            {"id": 2, "type": "message", "date_unixtime": "1704103200", "from_id": "user5", "text": None},
            {"id": 3, "type": "service", "action": "phone_call"},
            {"id": 4, "type": "unsupported"},
            {"id": 5, "date": "garbage", "text": [None, 5, {"type": "bold"}]},
            "not a dict",
        ]}
        (d / "result.json").write_text(json.dumps(chat), encoding="utf-8")
        exp = tc.load_export(str(d))
        c = exp.chats[0]
        self.assertEqual(c.name, "Без названия")
        st = tc.analyze_chat(c, set())
        self.assertEqual(st["messages"], 3)
        self.assertEqual(st["missed_calls"], 1)
        self.assertTrue(st["signal"])
        units = tc.render_conversation(c, set(), {}, tc.redact)
        self.assertTrue(any("Удалённый аккаунт: ТЗ и оплата 5 000 ₽" in u[1] for u in units))


# ----------------------------------------------------------------------------- me detection

class TestMe(unittest.TestCase):
    def test_full_export_uses_account_data(self):
        ids, name, how = tc.detect_me(tc.load_export(str(FX["full"])))
        self.assertEqual((ids, name), ({ME_ID}, "Алексей Пример"))
        self.assertIn("аккаунта", how)

    def test_heuristic_single_and_multi(self):
        for key in ("single", "multi"):
            ids, name, _ = tc.detect_me(tc.load_export(str(FX[key])))
            self.assertEqual(ids, {ME_ID}, key)
            self.assertEqual(name, "Алексей Пример")

    def test_override_by_name(self):
        exp = tc.load_export(str(FX["full"]))
        ids, name, how = tc.detect_me(exp, "марина образцова")
        self.assertEqual(ids, {"user1000000101"})
        ids, _, _ = tc.detect_me(exp, "Алексей")              # partial name
        self.assertEqual(ids, {ME_ID})
        with self.assertRaises(tc.UserError) as cm:
            tc.detect_me(exp, "Никто Никтоев")
        self.assertIn("Самые частые имена", str(cm.exception))


# ----------------------------------------------------------------------------- scoring

class TestScoring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.exp = tc.load_export(str(FX["full"]))
        cls.me, _, _ = tc.detect_me(cls.exp)
        cls.st = {c.key: tc.analyze_chat(c, cls.me) for c in cls.exp.kept}

    def test_clients_rank_above_friend(self):
        s = {k: v["score"] for k, v in self.st.items()}
        self.assertGreater(s[MARINA], s[JOHN])
        for client in (MARINA, JOHN, IGOR, SCHOOL, LANDING, SASHA1, SASHA2, ANNA):
            self.assertGreater(s[client], s[PETYA], client)
        self.assertGreater(s[PETYA], s[MAMA])
        self.assertFalse(self.st[MAMA]["signal"])
        games = {"kw": {"игра": 5, "сайт": 2}, "money": [], "files": [], "calls": 0, "voices": 0, "rounds": 0,
                 "messages": 300, "first": None, "last": None}
        self.assertFalse(tc.score_chat(games)[1])          # product words alone are not a work signal

    def test_nda_flags(self):
        self.assertTrue(self.st[TIXU]["nda"] and self.st[TIXU]["nda_in_name"])
        self.assertTrue(self.st[KATYA]["nda"])
        self.assertGreaterEqual(self.st[KATYA]["nda_hits"], 3)
        self.assertEqual(self.st[MARINA]["nda_hits"], 1)           # Eduson in passing
        self.assertFalse(self.st[MARINA]["nda"])
        extra = tc.make_nda_re(["Skillbox", "скиллбокс"])
        self.assertTrue(extra.search("работал в Скиллбоксе"))
        self.assertTrue(extra.search("TIXU.ai"))

    def test_stats(self):
        m = self.st[MARINA]
        self.assertEqual((m["voices"], m["rounds"], m["calls"], m["missed_calls"]), (3, 1, 1, 1))
        self.assertEqual(m["call_sec"], 754)
        self.assertEqual([a for _, _, a in m["money"]], ["45 000 ₽", "22 500 руб", "22 500 ₽"])
        self.assertEqual(len(m["files"]), 1)
        self.assertIsNone(self.st[JOHN]["lang"])          # English is never forced: Whisper detects it
        self.assertEqual(self.st[IGOR]["lang"], "ru")

    def test_keyword_cap(self):
        base = {"kw": {}, "money": [], "files": [], "calls": 0, "voices": 0, "rounds": 0, "messages": 500,
                "first": None, "last": None}
        spam = dict(base, kw={"ТЗ": 500})
        varied = dict(base, kw={"ТЗ": 3, "оплата": 3, "договор": 2, "дедлайн": 2, "правки": 2})
        self.assertLess(tc.score_chat(spam)[0], tc.score_chat(varied)[0])
        self.assertLessEqual(tc.score_chat(spam)[0], 3.0 * 4 + 0.5 * 3 + 0.5)

    def test_since_filter(self):
        exp = self.exp
        since = tc.dt.datetime(2026, 6, 1)
        st = tc.analyze_chat(exp.by_key()[MARINA], self.me, since)
        self.assertEqual(st["messages"], 0)

    def test_money_detection(self):
        cases = {
            "Стоимость 45 000 ₽ за 6 модулей": ["45 000 ₽"], "Budget is $1,200": ["$1,200"],
            "оплата 25к": ["25к"], "бюджет 120000": ["120000"], "это 50 тыс": ["50 тыс"],
            "2 млн руб": ["2 млн руб"], "300 USDT": ["300 USDT"], "€500": ["€500"],
            "10 тысяч учеников": [], "5 рабочих дней": [], "оплата до 15.03": [], "аванс в 2024 году": [],
            "15 к пятнице": [], "встреча 14:30": [],
        }
        for text, want in cases.items():
            self.assertEqual([a for _, _, a in tc.money_spans(text)], want, text)

    def test_keywords(self):
        def labels(t):
            return sorted({tc.KEYWORDS[int(m.lastgroup[1:])][0] for m in tc.KW_RE.finditer(t)})
        self.assertEqual(labels("Пришлю ТЗ и счёт"), ["ТЗ", "счёт"])
        self.assertEqual(labels("За счёт школы"), [])
        self.assertEqual(labels("Держи в курсе"), [])
        self.assertEqual(labels("В этом курсе 6 модулей"), ["курс", "модуль"])
        self.assertEqual(labels("чек-лист к уроку"), ["урок"])
        for casual in ("Договорились!", "Договоримся завтра", "Of course, see you", "иду в тренажёрный зал",
                       "briefly", "due to rain"):
            self.assertEqual(labels(casual), [], casual)
        self.assertEqual(labels("по договору, оплачу завтра"), ["договор", "оплата"])


# ----------------------------------------------------------------------------- find and the report

class LinkAudit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.boxes, self.meta_csp, self.scripts = [], [], None, []
        self._in_script = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append((tag, a))
        if tag == "input" and "data-chat" in a:
            self.boxes.append(a)
        if tag == "meta" and a.get("http-equiv", "").lower() == "content-security-policy":
            self.meta_csp = a.get("content")
        if tag == "script":
            self._in_script = a

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_script = None

    def handle_data(self, data):
        if self._in_script is not None:
            self.scripts.append((self._in_script, data))


class TestFind(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = fresh("find")
        cls.code, cls.stdout, cls.stderr = run_main("find", FX["full"], "--out", cls.out, "--no-open")
        cls.html = read(cls.out / "candidates.html")
        cls.data = json.loads(read(cls.out / "candidates.json"))
        cls.audit = LinkAudit()
        cls.audit.feed(cls.html)

    def test_summary_printed(self):
        self.assertEqual(self.code, 0, self.stderr)
        self.assertIn("Похожи на заказы:", self.stdout)
        self.assertIn("1. Марина", self.stdout)
        self.assertIn("candidates.html", self.stdout)
        self.assertEqual(oct(stat.S_IMODE(os.stat(self.out).st_mode)), oct(0o700))

    def test_order_and_sections(self):
        ids = [c["id"] for c in self.data["chats"]]
        self.assertEqual(ids[0], MARINA)
        self.assertEqual(ids[-1], MAMA)
        self.assertNotIn(BOT, ids)
        self.assertNotIn("3000000301", ids)
        rest = self.html.split('data-section="rest"', 1)[1]
        self.assertIn("Мама", rest)

    def test_self_contained(self):
        self.assertIsNotNone(self.audit.meta_csp)
        self.assertIn("default-src 'none'", self.audit.meta_csp)
        for tag, attrs in self.audit.tags:
            self.assertNotIn(tag, ("link", "img", "iframe", "object", "embed", "audio", "video", "source", "base"))
            for k, v in attrs.items():
                if k in ("src", "href", "action", "poster", "srcset", "data", "background") and v:
                    self.fail(f"{tag} {k}={v}")
        self.assertNotRegex(self.html, r"url\(|@import|<link|\bsrc\s*=")
        for attrs, _ in self.audit.scripts:
            self.assertNotIn("src", attrs)

    def test_nothing_pretricked_and_nda_marked(self):
        self.assertTrue(self.audit.boxes)
        self.assertFalse(any("checked" in b for b in self.audit.boxes))
        nda = {b["value"] for b in self.audit.boxes if b.get("data-nda") == "1"}
        self.assertEqual(nda, {TIXU, KATYA})

    def test_report_is_redacted(self):
        s = FX["secrets"]
        for secret in (s["card"], s["email"], s["anthropic"], s["password"], "4111", s["file_email"]):
            self.assertNotIn(secret, self.html)
            self.assertNotIn(secret, read(self.out / "candidates.json"))
        sasha2 = next(c for c in self.data["chats"] if c["id"] == SASHA2)
        self.assertIn("[файл: Реквизиты [email] [карта].pdf]", sasha2["snippets"]["first"][2]["text"])

    def test_snippets(self):
        marina = next(c for c in self.data["chats"] if c["id"] == MARINA)
        sn = marina["snippets"]
        self.assertEqual(len(sn["first"]), 3)
        self.assertTrue(sn["first"][0]["text"].startswith("Здравствуйте!"))
        self.assertLessEqual(len(sn["keywords"]), 6)
        self.assertTrue(all(len(k["before"] + k["match"] + k["after"]) <= 260 for k in sn["keywords"]))
        self.assertIn("<mark>", self.html)
        self.assertTrue(sn["money"])

    def test_command_in_page(self):
        data_script = [d for a, d in self.audit.scripts if a.get("id") == "cmd-data"][0]
        cmd = json.loads(data_script)
        self.assertEqual(cmd["prefix"], self.data["command_prefix"])
        full = cmd["prefix"] + f"{MARINA},{JOHN}" + cmd["suffix"]
        self.assertEqual(shlex.split(full), ["uv", "run", str(TOOL), "build", str(FX["full"]), "--chats",
                                             f"{MARINA},{JOHN}", "--out", str(self.out)])


class TestQuoting(unittest.TestCase):
    def test_paths_with_spaces_quotes_cyrillic(self):
        root = fresh("quoting")
        weird = root / "Экспорт 'клиенты' \"2026\" $HOME !x" / "ChatExport_2026-10-11"
        shutil.copytree(FX["single"], weird)
        out = root / "итог 'кейсы' ё"
        code, so, se = run_main("find", weird, "--out", out, "--no-open", "--me", "Алексей Пример")
        self.assertEqual(code, 0, se)
        data = json.loads(read(out / "candidates.json"))
        command = data["command_prefix"] + "1000000111" + data["command_suffix"]
        expected = [str(TOOL), "build", str(weird.resolve()), "--chats", "1000000111", "--out", str(out.resolve()),
                    "--me", "Алексей Пример"]
        self.assertEqual(shlex.split(command)[2:], expected)
        args_only = command[len("uv run "):]
        for shell in ("bash", "zsh", "sh"):
            exe = shutil.which(shell)
            if not exe:
                continue
            r = subprocess.run([exe, "-c", "printf '%s\\n' " + args_only], capture_output=True, text=True)
            self.assertEqual(r.stdout.splitlines(), expected, shell)
        self.assertEqual(tc.sh_quote("it's"), "'it'\\''s'")


# ----------------------------------------------------------------------------- build

class TestBuild(unittest.TestCase):
    CHATS = [MARINA, JOHN, IGOR, SCHOOL, LANDING, SASHA1, SASHA2, ANNA]

    @classmethod
    def setUpClass(cls):
        cls.out = fresh("build")
        cls.ws = cls.out / "claude"
        (cls.ws / "cases").mkdir(parents=True)
        (cls.ws / "cases" / "01-marina.md").write_text("черновик Claude", encoding="utf-8")
        tc.FakeEngine.calls = 0
        cls.code, cls.stdout, cls.stderr = run_main("build", FX["full"], "--chats", ",".join(cls.CHATS),
                                                    "--out", cls.out, "--engine", "fake")
        cls.dd = cls.ws / "dossiers"
        cls.marina = read(cls.dd / "01-marina.md")

    def test_files(self):
        self.assertEqual(self.code, 0, self.stderr)
        names = sorted(p.name for p in self.dd.iterdir())
        self.assertEqual(names, ["00-сводка.md", "01-marina.md", "02-john.md", "03-igor.part1.md", "03-igor.part2.md",
                                 "04-shkola-primer-zapusk-kursa.md", "05-lending-tilda.md", "06-aleksandr.md",
                                 "07-aleksandr-2.md", "08-anna.md"])
        for n in names[1:]:
            self.assertRegex(n, r"^[0-9a-z.\-]+$")
        self.assertEqual(read(self.ws / "cases" / "01-marina.md"), "черновик Claude")
        self.assertTrue((self.ws / "CLAUDE.md").is_file())
        self.assertEqual(tc.FakeEngine.calls, 5)

    def test_conversation_format(self):
        t = self.marina
        self.assertIn("### 2 марта 2026, понедельник", t)
        self.assertIn("10:40 Я: Добрый день!", t)
        self.assertIn("10:15 Марина Образцова: Здравствуйте!", t)
        # merged: the 10:16 message continues the 10:15 block without its own time and name
        self.assertIn("уровень A2.\nБриф пришлю сегодня, ТЗ тоже.", t)
        self.assertNotIn("10:16", t)
        self.assertIn("программа курса (https://docs.google.com/document/d/EXAMPLEdoc123/edit)", t)
        self.assertIn("11:00 Марина Образцова: [звонок, 13 мин]", t)
        self.assertIn("[пропущенный звонок]", t)
        self.assertIn("[голосовое 0:06] «тестовая расшифровка audio_1, 6 с»", t)
        self.assertIn("[видеосообщение 0:04] «тестовая расшифровка file_1, 4 с»", t)
        self.assertIn("[стикер 👍]", t)
        self.assertIn("[фото] Скрин из LMS", t)
        self.assertIn("[файл: Бриф_курс_A2.docx] Вот бриф и ТЗ", t)
        self.assertIn("[переслано, автор: Ольга Тестова] Отзыв ученика", t)
        self.assertIn("(в ответ на: «Вот программа курса, а макет урока в", t)

    def test_header(self):
        t = self.marina
        self.assertIn("- Чат: Марина (личный чат, id 1000000101)", t)
        self.assertIn("- Период: 02.03.2026 – 07.04.2026, 37 дней", t)
        self.assertIn("- Звонки: 1, всего 13 мин; пропущенные: 1", t)
        self.assertIn("- 03.03.2026, «45 000 ₽»: Посмотрел ТЗ.", t)
        self.assertIn("- 02.03.2026, Марина Образцова: Бриф_курс_A2.docx", t)
        self.assertIn("docs.google.com (1):\n- https://docs.google.com/document/d/EXAMPLEdoc123/edit", t)
        self.assertIn("«Я» в переписке: Алексей Пример", t)
        self.assertIn("- NDA: упоминается Eduson (1 раз в переписке). Если это рабочий чат Eduson", t)
        self.assertTrue(t.startswith("# 01. Марина Образцова\n"))     # full name, not just «Марина»

    def test_redacted(self):
        s = FX["secrets"]
        for name in os.listdir(self.dd):
            text = read(self.dd / name)
            for secret in (s["card"], s["email"], s["phone"], s["anthropic"], s["password"], s["bot"], "school-admin",
                       s["file_email"], "4111111111111111"):
                self.assertNotIn(secret, text, name)
        for token in ("[карта]", "[email]", "[телефон]", "[ключ]", "[пароль]", "[логин]"):
            self.assertIn(token, self.marina)
        self.assertIn("45 000 ₽", self.marina)
        self.assertIn("22 500 руб.", self.marina)

    def test_missing_media(self):
        t = read(self.dd / "08-anna.md")
        self.assertEqual(t.count("(голосовое не выгружено)"), 2)
        self.assertIn("[видеосообщение 0:09] (видеосообщение не выгружено)", t)

    def test_group(self):
        t = read(self.dd / "04-shkola-primer-zapusk-kursa.md")
        self.assertIn("Сергей Примеров: Счёт на 30 000 руб выставили", t)
        self.assertIn("Удалённый аккаунт: Сообщение от удалённого аккаунта", t)
        self.assertIn("[опрос: «Когда созвон?»; варианты: Вторник (2); Среда (1)]", t)
        self.assertIn("[групповой звонок, 40 мин]", t)
        self.assertIn("Итоги созвона: стоимость модуля согласовали.", t)
        self.assertIn("- Участники: Я (1), ", t)

    def test_split(self):
        p1, p2 = read(self.dd / "03-igor.part1.md"), read(self.dd / "03-igor.part2.md")
        self.assertLessEqual(len(p1), tc.SPLIT_LIMIT)
        self.assertLessEqual(len(p2), tc.SPLIT_LIMIT)
        self.assertTrue(p1.startswith("# 03. Игорь Длинный, часть 1 из 2\n"))
        self.assertTrue(p2.startswith("# 03. Игорь Длинный, часть 2 из 2\n"))
        self.assertIn("в файле 03-igor.part1.md", p2)
        self.assertIn("03-igor.part1.md – 03-igor.part2.md: Игорь Длинный (2 части)", self.stdout)
        self.assertIn("(продолжение)", p2)
        self.assertIn("Бюджет 120 000 руб", p1)
        n = len(re.findall(r"^\d\d:\d\d (?:Я|Игорь Длинный): ", p1 + p2, re.M))
        self.assertEqual(n, 1601)

    def test_split_units_unit(self):
        units = [("day", "### 1 января 2026, четверг")] + [("block", f"10:{i:02d} Я: " + "х" * 300) for i in range(60)]
        header = "# 01. Тест\n\nшапка\n"
        files = tc.split_units(header, units, "Тест", 1, "test", limit=12000)
        self.assertGreater(len(files), 1)
        self.assertTrue(all(len(f) <= 12000 for f in files))
        self.assertTrue(files[1].startswith(f"# 01. Тест, часть 2 из {len(files)}"))
        self.assertIn("### 1 января 2026, четверг (продолжение)", files[1])
        giant = [("block", "10:00 Я: " + "Q" * 50000)]
        files = tc.split_units(header, giant, "Тест", 1, "test", limit=12000)
        self.assertEqual("".join(files).count("Q"), 50000)
        self.assertTrue(all(len(f) <= 12000 for f in files))

    def test_summary_and_claude_md(self):
        s = read(self.dd / "00-сводка.md")
        for n in ("01-marina.md", "03-igor.part1.md, 03-igor.part2.md", "07-aleksandr-2.md", "🚀 Лендинг / Тильда"):
            self.assertIn(n, s)
        c = read(self.ws / "CLAUDE.md")
        for phrase in ("cases/00-обзор.md", "Услуга на сайте", "Аудит: Разбор курса и пути ученика",
                       "Гайд: Тренажёр по нейросетям на делах близкого человека", "Риски публикации",
                       "Сообщение заказчику", "Якорь: #case-english-a2-course", "Tixu", "Eduson",
                       "# Для Даниила, не публиковать", "(из голосового, проверь)", "Файлы уровнем выше не открывай"):
            self.assertIn(phrase, c)
        # the public anchor must not come from the dossier name (a client's name)
        self.assertNotIn("slug из имени досье", c)
        self.assertIn("не бери из них якорь", c)
        self.assertNotIn("{NDA_RULE}", c)

    def test_no_arrows_or_middle_dots(self):
        texts = [read(self.dd / n) for n in os.listdir(self.dd)] + [read(HERE.parent / "README.md")]
        texts.append(read(self.out / "candidates.html") if (self.out / "candidates.html").exists() else "")
        for t in texts:
            self.assertNotIn("→", t)
            self.assertNotIn("·", t)
        # CLAUDE.md names both characters once, in the rule that forbids them
        lines = [ln for ln in read(self.ws / "CLAUDE.md").splitlines() if "→" in ln or "·" in ln]
        self.assertEqual(lines, ["- Не используй стрелки «→» и средние точки «·»."])

    def test_rebuild_keeps_numbers(self):
        out = fresh("rebuild")
        code, _, err = run_main("build", FX["full"], "--chats", f"{SASHA1},{SASHA2}", "--out", out, "--engine", "fake")
        self.assertEqual(code, 0, err)
        code, _, err = run_main("build", FX["full"], "--chats", f"{SASHA2},{JOHN}", "--out", out, "--engine", "fake")
        self.assertEqual(code, 0, err)
        names = sorted(os.listdir(out / "claude" / "dossiers"))
        self.assertEqual(names, ["00-сводка.md", "01-aleksandr.md", "02-aleksandr-2.md", "03-john.md"])
        self.assertIn("03-john.md", read(out / "claude" / "dossiers" / "00-сводка.md"))

    def test_no_redact(self):
        out = fresh("noredact")
        code, _, err = run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake",
                                "--no-redact")
        self.assertEqual(code, 0, err)
        self.assertIn(FX["secrets"]["card"], read(out / "claude" / "dossiers" / "01-marina.md"))


class TestCache(unittest.TestCase):
    def test_resume_after_interrupt(self):
        out = fresh("cache")
        real = tc.FakeEngine.transcribe_file
        state = {"n": 0}

        def flaky(self, path, language, duration):
            state["n"] += 1
            if state["n"] == 3:
                raise KeyboardInterrupt
            return real(self, path, language, duration)

        with mock.patch.object(tc.FakeEngine, "transcribe_file", flaky):
            code, _, err = run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(code, 130)
        self.assertIn("продолжу", err)
        cache = json.loads(read(out / ".cache" / "transcripts.json"))
        self.assertEqual(len(cache), 2)
        tc.FakeEngine.calls = 0
        code, so, err = run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(code, 0, err)
        self.assertEqual(tc.FakeEngine.calls, 2)               # 4 files on disk, 2 were cached
        self.assertIn("уже расшифровано раньше 2", so)
        tc.FakeEngine.calls = 0
        run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(tc.FakeEngine.calls, 0)
        self.assertNotIn(".tmp", " ".join(os.listdir(out / ".cache")))

    def test_no_voice_reuses_real_transcripts_only(self):
        out = fresh("novoice")
        code, _, err = run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--no-voice")
        self.assertEqual(code, 0, err)
        t = read(out / "claude" / "dossiers" / "01-darya.md")
        self.assertIn("[голосовое 0:05] (не расшифровано)", t)
        cache_path = out / ".cache" / "transcripts.json"
        items = tc.voice_items(tc.load_export(str(FX["single"])).chats[0])
        tc.atomic_write_json(cache_path, {items[0].key: {"text": "Привет, это настоящая расшифровка", "engine": "mlx"},
                                          items[1].key: {"text": "фейк", "engine": "fake"}})
        code, _, err = run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--no-voice")
        t = read(out / "claude" / "dossiers" / "01-darya.md")
        self.assertIn("«Привет, это настоящая расшифровка»", t)
        self.assertIn("[видеосообщение 0:03] (не расшифровано)", t)


class TestBuildErrors(unittest.TestCase):
    def test_unknown_and_skipped_ids(self):
        out = fresh("errors")
        code, _, err = run_main("build", FX["full"], "--chats", "123,456", "--out", out, "--engine", "fake")
        self.assertEqual(code, 2)
        self.assertIn("Не нашёл в выгрузке чаты с номерами: 123, 456", err)
        self.assertIn("candidates.html", err)
        code, _, err = run_main("build", FX["full"], "--chats", BOT, "--out", out, "--engine", "fake")
        self.assertEqual(code, 2)
        self.assertIn("не обрабатываю", err)

    def test_cli_errors_have_no_traceback(self):
        cases = [
            (["build", FX["full"]], "не хватает обязательных параметров"),
            (["find", BASE / "nope"], "Не нашёл"),
            (["find", FX["html_only"]], "Машиночитаемый JSON"),
            (["find", FX["full"], "--since", "вчера"], "ГГГГ-ММ-ДД"),
            (["build", FX["full"], "--chats", MARINA, "--engine", "turbo", "--out", BASE / "runs" / "e"], "Неизвестный движок"),
        ]
        for argv, needle in cases:
            r = run_cli(*argv)
            self.assertEqual(r.returncode, 2, argv)
            self.assertIn(needle, r.stderr, argv)
            self.assertNotIn("Traceback", r.stderr + r.stdout, argv)

    def test_missing_speech_libraries(self):
        with mock.patch.object(tc, "has_module", return_value=False):
            with self.assertRaises(tc.UserError) as cm:
                tc.make_engine("auto")
        self.assertIn("uv run", str(cm.exception))
        self.assertIn("--no-voice", str(cm.exception))


# ----------------------------------------------------------------------------- redaction

class TestRedaction(unittest.TestCase):
    def test_true_positives(self):
        s = mf.fake_secrets()
        cases = {
            f"Карта {s['card']}": "Карта [карта]",
            "карта 4111111111111111": "карта [карта]",
            "карта 5500-0000-0000-0004": "карта [карта]",
            f"тел {s['phone']}": "тел [телефон]",
            "тел 8 900 000 00 00": "тел [телефон]",
            "тел (900) 000-00-00": "тел [телефон]",
            "звони +79000000000": "звони [телефон]",
            "London +44 20 7946 0000": "London [телефон]",
            f"почта {s['email']}": "почта [email]",
            "или test@почта.рф": "или [email]",
            f"IBAN {s['iban']} EUR": "IBAN [счёт] EUR",
            f"счёт {s['account']}": "счёт [счёт]",
            "паспорт 4510 123456": "паспорт [паспорт]",
            "СНИЛС 112-233-445 95": "СНИЛС [СНИЛС]",
            "ИНН 123456789012": "ИНН [реквизиты]",
            f"пароль: {s['password']}": "пароль: [пароль]",
            "Пароль от Тильды: Abc123!": "Пароль от Тильды: [пароль]",
            "логин: school-admin, пароль: Qwe123": "логин: [логин], пароль: [пароль]",
            "логин/пароль: admin / Qwe123": "логин/пароль: [логин] / [пароль]",
            "password=hunter2": "password=[пароль]",
            "пароль Qwerty123.": "пароль [пароль].",
            "пароль - xyz9": "пароль - [пароль]",
            "пароль: abc / потом поменяю": "пароль: [пароль] / потом поменяю",
            f"ключ {s['anthropic']}": "ключ [ключ]",
            "ключ sk-" + "proj-" + "a1B2c3D4" * 4: "ключ [ключ]",
            "токен " + s["github"]: "токен [ключ]",
            "AIza" + "SyD1" * 9 + "xyz": "[ключ]",
            "xox" + "b-123456789012-abcdefABCDEF": "[ключ]",
            "бот " + s["bot"]: "бот [ключ]",
            "Authorization: Bearer " + "abc.DEF_123-xyz" * 2: "Authorization: Bearer [ключ]",
            "секрет " + s["random"]: "секрет [ключ]",
            "hash d41d8cd98f00b204e9800998ecf8427e": "hash [ключ]",
            "https://api.telegram.org/bot" + s["bot"] + "/sendMessage": "https://api.telegram.org/bot[ключ]/sendMessage",
            "https://site.example.com/?token=abc123secret&x=1": "https://site.example.com/?token=[ключ]&x=1",
        }
        for src, want in cases.items():
            self.assertEqual(tc.redact(src), want, src)

    def test_keeps_money_dates_and_links(self):
        keep = [
            "Стоимость 45 000 ₽", "1 500 000 руб", "$1,200", "итого 1 000 000 000 000 ₽", "созвон в 8 900 000 руб?",
            "встреча 14.03.2026 в 14:05", "2026-03-14", "12/03/2026", "в 2024 году", "с 10:00 до 18:00", "1:02:03",
            "заказ №12345", "заказ 1234567", "ID 1000000101", "unix 1710846333", "+15% к конверсии", "25к",
            "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG/edit",
            "https://www.figma.com/file/AbCdEfGh12345678/Project-Name",
            "Презентация_итоговая_версия_v3_final_2024.pptx", "My_Project_Final_Presentation_2024_v2.docx",
            "audio_1@02-03-2026_12-07-00.ogg", "пароль пришлю позже", "pass the test", "телефон пришлю",
            "8 модулей и 40 уроков", "v1.2.3", "@username в телеграме", "логин - это ваша почта",
        ]
        for text in keep:
            self.assertEqual(tc.redact(text), text)

    def test_luhn_and_iban(self):
        self.assertTrue(tc._luhn_ok("4111111111111111"))
        self.assertFalse(tc._luhn_ok("4111111111111112"))
        self.assertEqual(tc.redact("номер 4111 1111 1111 1112"), "номер 4111 1111 1111 1112")
        self.assertTrue(tc._iban_ok("DE89370400440532013000"))
        self.assertFalse(tc._iban_ok("DE89370400440532013001"))


# ----------------------------------------------------------------------------- transcription helpers

class TestHallucinations(unittest.TestCase):
    def test_filter(self):
        cases = {
            "Субтитры сделал DimaTorzok": "", "Спасибо за просмотр!": "", "Thanks for watching!": "",
            "Редактор субтитров А.Синецкая Корректор А.Егорова": "", "Продолжение следует...": "",
            "Привет, это Марина. Продолжение следует...": "Привет, это Марина.",
            "Hello there. Subtitles by the Amara.org community": "Hello there.",
            "Пока!": "Пока!", "Ну всё, пока!": "Ну всё, пока!", "Корректор нужен.": "Корректор нужен.",
            "Субтитры к фильму мы сделаем сами.": "Субтитры к фильму мы сделаем сами.",
            "ДИНАМИЧНАЯ МУЗЫКА": "",
        }
        for src, want in cases.items():
            self.assertEqual(tc.clean_hallucinations(src), want, src)
        self.assertFalse(tc.keep_segment(0.9, -1.5))
        self.assertTrue(tc.keep_segment(0.9, -0.3))

    def test_voice_labels(self):
        chat = tc.load_export(str(FX["single"])).chats[0]
        voice, rnd = tc.voice_items(chat)
        self.assertEqual(tc.voice_label(voice, {"text": ""}, False), "[голосовое 0:05] (не разобрать)")
        self.assertEqual(tc.voice_label(rnd, {"text": "", "status": "noaudio"}, False), "[видеосообщение 0:03] (без звука)")
        self.assertEqual(tc.voice_label(voice, None, True), "[голосовое 0:05] (не расшифровано)")


def _stub_modules(record: dict) -> dict:
    """Stubs with the exact signatures of mlx-whisper 0.4.3 and faster-whisper 1.2.1."""
    mlx_pkg = types.ModuleType("mlx")
    mlx_core = types.ModuleType("mlx.core")
    mlx_core.float16 = "float16"
    mlx_pkg.core = mlx_core

    decoding_fields = {"task", "language", "temperature", "sample_len", "best_of", "beam_size", "patience",
                       "length_penalty", "prompt", "prefix", "suppress_tokens", "suppress_blank",
                       "without_timestamps", "max_initial_timestamp", "fp16"}

    def mlx_transcribe(audio, *, path_or_hf_repo="mlx-community/whisper-tiny", verbose=None,
                       temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0), compression_ratio_threshold=2.4,
                       logprob_threshold=-1.0, no_speech_threshold=0.6, condition_on_previous_text=True,
                       initial_prompt=None, word_timestamps=False, prepend_punctuations="\"'“¿([{-",
                       append_punctuations="\"'.。,，!！?？:：”)]}、", clip_timestamps="0",
                       hallucination_silence_threshold=None, **decode_options):
        unknown = set(decode_options) - decoding_fields
        if unknown:
            raise TypeError(f"DecodingOptions got unexpected {unknown}")
        record["mlx_transcribe"] = dict(path_or_hf_repo=path_or_hf_repo, verbose=verbose,
                                        condition_on_previous_text=condition_on_previous_text,
                                        temperature=temperature, no_speech_threshold=no_speech_threshold,
                                        compression_ratio_threshold=compression_ratio_threshold,
                                        logprob_threshold=logprob_threshold, **decode_options)
        return {"text": "x", "language": "ru", "segments": [
            {"text": " Привет, это тест.", "no_speech_prob": 0.1, "avg_logprob": -0.2},
            {"text": " шум", "no_speech_prob": 0.9, "avg_logprob": -1.5},
            {"text": " Субтитры сделал DimaTorzok", "no_speech_prob": 0.2, "avg_logprob": -0.4},
        ]}

    mlx_whisper = types.ModuleType("mlx_whisper")
    mlx_whisper.transcribe = mlx_transcribe
    mlx_whisper_t = types.ModuleType("mlx_whisper.transcribe")

    class ModelHolder:
        @staticmethod
        def get_model(model_path, dtype):
            record["mlx_get_model"] = (model_path, dtype)

    mlx_whisper_t.ModelHolder = ModelHolder

    fw = types.ModuleType("faster_whisper")
    fw_utils = types.ModuleType("faster_whisper.utils")
    fw_utils._MODELS = {"large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
                        "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"}

    class Segment:
        def __init__(self, text, nsp, lp):
            self.text, self.no_speech_prob, self.avg_logprob = text, nsp, lp

    class WhisperModel:
        def __init__(self, model_size_or_path, device="auto", device_index=0, compute_type="default",
                     cpu_threads=0, num_workers=1, download_root=None, local_files_only=False, files=None,
                     revision=None, use_auth_token=None, **model_kwargs):
            record["fw_init"] = dict(model=model_size_or_path, device=device, compute_type=compute_type,
                                     cpu_threads=cpu_threads, model_kwargs=model_kwargs)

        def transcribe(self, audio, language=None, task="transcribe", log_progress=False, beam_size=5, best_of=5,
                       patience=1, length_penalty=1, repetition_penalty=1, no_repeat_ngram_size=0,
                       temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0], compression_ratio_threshold=2.4,
                       log_prob_threshold=-1.0, no_speech_threshold=0.6, condition_on_previous_text=True,
                       prompt_reset_on_temperature=0.5, initial_prompt=None, prefix=None, suppress_blank=True,
                       suppress_tokens=[-1], without_timestamps=False, max_initial_timestamp=1.0,
                       word_timestamps=False, prepend_punctuations="\"'“¿([{-",
                       append_punctuations="\"'.。,，!！?？:：”)]}、", multilingual=False, vad_filter=False,
                       vad_parameters=None, max_new_tokens=None, chunk_length=None, clip_timestamps="0",
                       hallucination_silence_threshold=None, hotwords=None, language_detection_threshold=0.5,
                       language_detection_segments=1):
            record["fw_transcribe"] = dict(language=language, beam_size=beam_size, vad_filter=vad_filter,
                                           vad_parameters=vad_parameters,
                                           condition_on_previous_text=condition_on_previous_text)

            def gen():
                record["fw_iterated"] = True
                yield Segment(" Hello, this is a test.", 0.1, -0.2)
                yield Segment(" noise", 0.95, -1.4)
                yield Segment(" Thank you for watching.", 0.3, -0.5)

            return gen(), types.SimpleNamespace(language=language or "en")

    fw.WhisperModel = WhisperModel
    fw.utils = fw_utils
    return {"mlx": mlx_pkg, "mlx.core": mlx_core, "mlx_whisper": mlx_whisper,
            "mlx_whisper.transcribe": mlx_whisper_t, "faster_whisper": fw, "faster_whisper.utils": fw_utils}


class FakeAudio:
    size = 5 * tc.SAMPLE_RATE


class TestEngineStubs(unittest.TestCase):
    def setUp(self):
        self.rec = {}
        self.model_dir = fresh("model")
        self.model_dir.mkdir()
        patches = [mock.patch.dict(sys.modules, _stub_modules(self.rec)),
                   mock.patch.object(tc, "decode_audio", lambda path: FakeAudio()),
                   mock.patch.object(tc, "is_silent", lambda audio: False)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_mlx_calls(self):
        eng = tc.MlxEngine(str(self.model_dir))
        eng.load()
        self.assertEqual(self.rec["mlx_get_model"], (str(self.model_dir), "float16"))
        text, sec = eng.transcribe_file("x.ogg", "ru", 5)
        self.assertEqual(text, "Привет, это тест.")
        self.assertEqual(sec, 5.0)
        call = self.rec["mlx_transcribe"]
        self.assertEqual(call["path_or_hf_repo"], str(self.model_dir))
        self.assertIsNone(call["verbose"])
        self.assertFalse(call["condition_on_previous_text"])
        self.assertEqual(call["language"], "ru")
        self.assertEqual(call["logprob_threshold"], -1.0)

    def test_mlx_default_model_download(self):
        eng = tc.MlxEngine()
        self.assertEqual(eng.model, "mlx-community/whisper-large-v3-turbo")
        self.assertEqual(tc.MlxEngine("turbo").model, "mlx-community/whisper-large-v3-turbo")
        with self.assertRaises(tc.UserError):
            tc.MlxEngine("small")
        with mock.patch.object(tc, "fetch_model", return_value=str(self.model_dir)) as fm:
            eng.load()
        self.assertEqual(fm.call_args[0][0], "mlx-community/whisper-large-v3-turbo")
        self.assertEqual(eng.path, str(self.model_dir))

    def test_faster_calls(self):
        eng = tc.FasterEngine()
        self.assertEqual(eng.model, "large-v3-turbo")
        with mock.patch.object(tc, "fetch_model", return_value=str(self.model_dir)) as fm:
            eng.load()
        self.assertEqual(fm.call_args[0][0], "mobiuslabsgmbh/faster-whisper-large-v3-turbo")
        init = self.rec["fw_init"]
        self.assertEqual((init["model"], init["device"], init["compute_type"]), (str(self.model_dir), "cpu", "int8"))
        self.assertGreaterEqual(init["cpu_threads"], 4)
        text, _ = eng.transcribe_file("x.ogg", None, 5)
        self.assertEqual(text, "Hello, this is a test.")
        self.assertTrue(self.rec["fw_iterated"])
        call = self.rec["fw_transcribe"]
        self.assertEqual((call["beam_size"], call["vad_filter"], call["condition_on_previous_text"]), (5, True, False))
        self.assertEqual(call["vad_parameters"], {"min_silence_duration_ms": 500})

    def test_auto_engine_choice(self):
        with mock.patch.object(tc, "has_module", return_value=True):
            with mock.patch.object(tc, "is_apple_silicon", return_value=True):
                self.assertIsInstance(tc.make_engine("auto"), tc.MlxEngine)
            with mock.patch.object(tc, "is_apple_silicon", return_value=False):
                self.assertIsInstance(tc.make_engine("auto"), tc.FasterEngine)
        self.assertIsInstance(tc.make_engine("fake"), tc.FakeEngine)

    def test_fetch_model_cache_then_download(self):
        calls = []
        local = self.model_dir

        def snapshot_download(repo_id, local_files_only=False, allow_patterns=None, **kw):
            calls.append(local_files_only)
            if local_files_only:
                raise OSError("not cached")
            for f in ("model.bin", "config.json", "tokenizer.json"):
                (local / f).write_text("x")
            return str(local)

        hub = types.ModuleType("huggingface_hub")
        hub.snapshot_download = snapshot_download
        with mock.patch.dict(sys.modules, {"huggingface_hub": hub}), contextlib.redirect_stdout(io.StringIO()):
            path = tc.fetch_model("org/repo", tc.FW_PATTERNS, ["model.bin", "config.json", "tokenizer.json"])
            self.assertEqual(path, str(local))
            self.assertEqual(calls, [True, False])
            calls.clear()

            def cached(repo_id, local_files_only=False, allow_patterns=None, **kw):
                calls.append(local_files_only)
                return str(local)

            hub.snapshot_download = cached
            tc.fetch_model("org/repo", tc.FW_PATTERNS, ["model.bin", "config.json", "tokenizer.json"])
            self.assertEqual(calls, [True])                  # cached: no network call


# ----------------------------------------------------------------------------- real PyAV decoding

def _av_python():
    if tc.has_module("av") and tc.has_module("numpy"):
        return None                                          # in-process
    for cand in (os.environ.get("TG_CASES_AV_PYTHON"), str(BASE / "venv" / "bin" / "python")):
        if cand and Path(cand).is_file():
            return cand
    return False


class TestDecode(unittest.TestCase):
    SNIPPET = (
        "import json, sys\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "import tg_cases as tc\n"
        "out = {}\n"
        "for p in sys.argv[2:]:\n"
        "    try:\n"
        "        a = tc.decode_audio(p)\n"
        "        out[p] = {'dtype': str(a.dtype), 'ndim': a.ndim, 'n': int(a.size), 'peak': float(abs(a).max()) if a.size else 0.0,\n"
        "                  'silent': tc.is_silent(a)}\n"
        "    except tc.NoAudioStream:\n"
        "        out[p] = 'noaudio'\n"
        "print(json.dumps(out))\n"
    )

    def test_decode_real_files(self):
        if not FX.get("has_ffmpeg"):
            self.skipTest("ffmpeg or the reel is missing: fixture media are dummies")
        py = _av_python()
        if py is False:
            self.skipTest("no Python with av and numpy (set TG_CASES_AV_PYTHON)")
        single = FX["single"]
        files = [str(next((single / "voice_messages").iterdir())),
                 str(next((FX["full"] / "chats" / "chat_01" / "round_video_messages").iterdir())),
                 str(next((single / "round_video_messages").iterdir())),
                 str(next((FX["full"] / "chats" / "chat_03" / "voice_messages").iterdir()))]
        if py is None:
            res = {}
            for f in files:
                try:
                    arr = tc.decode_audio(f)
                    res[f] = {"dtype": str(arr.dtype), "ndim": arr.ndim, "n": int(arr.size),
                              "peak": float(abs(arr).max()) if arr.size else 0.0, "silent": tc.is_silent(arr)}
                except tc.NoAudioStream:
                    res[f] = "noaudio"
        else:
            r = subprocess.run([py, "-c", self.SNIPPET, str(TOOL.parent)] + files, capture_output=True, text=True,
                               timeout=120)
            self.assertEqual(r.returncode, 0, r.stderr)
            res = json.loads(r.stdout)
        ogg, rnd, mute, silence = (res[f] for f in files)
        self.assertEqual((ogg["dtype"], ogg["ndim"]), ("float32", 1))
        self.assertAlmostEqual(ogg["n"] / tc.SAMPLE_RATE, 5.0, delta=0.1)      # speech2: 5 s of the reel
        self.assertGreater(ogg["peak"], 0.05)
        self.assertFalse(ogg["silent"])
        self.assertEqual(rnd["dtype"], "float32")
        self.assertAlmostEqual(rnd["n"] / tc.SAMPLE_RATE, 4.0, delta=0.15)     # 4 s round video, AAC stereo
        self.assertEqual(mute, "noaudio")
        self.assertTrue(silence["silent"])

    def test_matches_ffmpeg_cli(self):
        ff = shutil.which("ffmpeg")
        py = _av_python()
        if not ff or not FX.get("has_ffmpeg") or py is False:
            self.skipTest("needs ffmpeg CLI and a Python with av and numpy")
        src = str(next((FX["single"] / "voice_messages").iterdir()))
        code = (
            "import sys, subprocess, numpy as np\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "import tg_cases as tc\n"
            "a = tc.decode_audio(sys.argv[2])\n"
            "raw = subprocess.run([sys.argv[3], '-loglevel', 'error', '-i', sys.argv[2], '-ar', '16000', '-ac', '1',"
            " '-f', 'f32le', '-'], capture_output=True).stdout\n"
            "b = np.frombuffer(raw, dtype=np.float32)\n"
            "n = min(a.size, b.size)\n"
            "print(float(np.corrcoef(a[:n], b[:n])[0, 1]), abs(a.size - b.size))\n"
        )
        r = subprocess.run([py or sys.executable, "-c", code, str(TOOL.parent), src, ff], capture_output=True,
                           text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        corr, diff = r.stdout.split()
        self.assertGreater(float(corr), 0.99)
        self.assertLess(int(diff), 400)


# ----------------------------------------------------------------------------- regressions from the reviews

def _msg(i, when, who, text="", **extra):
    m = {"id": i, "type": "message", "date": when.strftime("%Y-%m-%dT%H:%M:%S"), "from": who[0],
         "from_id": f"user{who[1]}", "text": text}
    m.update(extra)
    return m


def _chat(msgs, name="Тест", ctype="personal_chat", cid=777):
    return tc.Chat({"name": name, "type": ctype, "id": cid, "messages": msgs}, Path("."), Path("result.json"))


ME_T = ("Алексей Пример", 1000000001)
PEER_T = ("Тест Собеседник", 777)


def _talk(lines, start=None, step_min=90, peer=PEER_T):
    t = start or tc.dt.datetime(2024, 1, 1, 10, 0)
    out = []
    for i, text in enumerate(lines):
        t += tc.dt.timedelta(minutes=step_min)
        out.append(_msg(i + 1, t, ME_T if i % 2 else peer, text))
    return out


class TestRedactionRegressions(unittest.TestCase):
    def test_numbers_followed_by_words_like_currency(self):
        cases = {
            "Пиши на 8 900 123 45 67 к 10 утра": "Пиши на [телефон] к 10 утра",
            "Мой номер 89001234567 к сведению": "Мой номер [телефон] к сведению",
            "тел +7 900 123 45 67 k": "тел [телефон] k",
            "Номер карты 4111 1111 1111 1111 к сожалению": "Номер карты [карта] к сожалению",
            "Карта 5555 5555 5555 4444 р. Иванова": "Карта [карта] р. Иванова",
            "карта 4111 1111 1111 1111 руб": "карта [карта] руб",
            "4111 1111 1111 1111 12/27": "[карта] 12/27",
        }
        for src, want in cases.items():
            self.assertEqual(tc.redact(src), want, src)

    def test_phone_formats_and_links(self):
        cases = {
            "79123456789": "[телефон]", "7 912 345 67 89": "[телефон]", "912-345-67-89": "[телефон]",
            "912 345 67 89": "[телефон]", "+7.912.345.67.89": "[телефон]", "8 (9123) 45-67-89": "[телефон]",
            "+1.202.555.0175": "[телефон]",
            "https://wa.me/79001234567": "https://wa.me/[телефон]",
            "https://t.me/+79001234567": "https://t.me/+[телефон]",
            "https://api.whatsapp.com/send?phone=79001234567": "https://api.whatsapp.com/send?phone=[телефон]",
            "https://example.com/pay?card=4111111111111111": "https://example.com/pay?card=[карта]",
            "https://admin:Qwerty12@site.example.com/wp-admin": "https://[логин]:[пароль]@site.example.com/wp-admin",
            "https://hooks.slack.com/services/" + "T0ABCDEF1/" + "B0ABCDEF2/" + "aB3dE6gH9jK2mN5pQ8sT1vW4":  # split: push protection
                "https://hooks.slack.com/services/[ключ]",
            "https://discord.com/api/webhooks/123456789012345678/abcDEF123": "https://discord.com/api/webhooks/[ключ]",
        }
        for src, want in cases.items():
            self.assertEqual(tc.redact(src), want, src)

    def test_bank_accounts_and_documents(self):
        cases = {
            "р/с 40817 810 0 0000 0001234, БИК 044525225, к/с 30101 810 4 0000 0000225":
                "р/с [счёт], БИК [реквизиты], к/с [счёт]",
            "счёт 408 17 810 0 9999 1234567": "счёт [счёт]",
            "р/с 4081 7810 0999 1000 4312": "р/с [счёт]",
            "серия 4510, номер 123456": "серия [паспорт]",
            "Данные паспорта: серия 4510, номер 123456": "Данные паспорта: серия [паспорт]",
            "паспорт 4510-123456": "паспорт [паспорт]",
            "пасп. 4510 123456": "пасп. [паспорт]",
            "СНИЛС 112 233 445 95": "СНИЛС [СНИЛС]",
            "iban: de89 3704 0044 0532 0130 00": "iban: [счёт]",
            "мой инн 500100732259": "мой инн [реквизиты]",
        }
        for src, want in cases.items():
            self.assertEqual(tc.redact(src), want, src)

    def test_passwords_with_qualifiers_and_labelled_keys(self):
        cases = {
            "Пароль от админки GetCourse: Abc12345": "Пароль от админки GetCourse: [пароль]",
            "пароль от личного кабинета: Qwerty123": "пароль от личного кабинета: [пароль]",
            "Пароль к почте школы: Zx9pLm2q": "Пароль к почте школы: [пароль]",
            "Пароль от аккаунта Tilda - Kx9mPq2Lz": "Пароль от аккаунта Tilda - [пароль]",
            "пароль от тильды Kx9#mPq2": "пароль от тильды [пароль]",
            "мой пароль везде одинаковый: Qwerty12": "мой пароль везде одинаковый: [пароль]",
            "доступ к админке: admin / Passw0rd!": "доступ к админке: [логин] / [пароль]",
            "логин и пароль от тильды: admin / Qwerty1": "логин и пароль от тильды: [логин] / [пароль]",
            "Доступ к GetCourse: логин: school-admin, пароль: Kx9#mPq2Lz":
                "Доступ к GetCourse: логин: [логин], пароль: [пароль]",
            "ключ API: 7f3k29dk3m": "ключ API: [ключ]",
            "токен: Ab12Cd34Ef56": "токен: [ключ]",
            "token=Ab12Cd34Ef56Gh78": "token=[ключ]",
            "secret: Ab12Cd34Ef56Gh78": "secret: [ключ]",
            "ключ тильды a1b2c3d4e5f6g7h8i9j0": "ключ тильды [ключ]",
            "Код доступа: 123456": "Код доступа: [пароль]",
            "ivan[at]example.com": "[email]",
            "2202  2000  1234  5672": "[карта]",
            "2202.2000.1234.5672": "[карта]",
        }
        for src, want in cases.items():
            self.assertEqual(tc.redact(src), want, src)

    def test_underscore_file_names(self):
        cases = {
            "Паспорт_4510_123456.pdf": "Паспорт_[паспорт].pdf",
            "card_4111111111111111.png": "card_[карта].png",
            "Реквизиты_40817810099910004312.pdf": "Реквизиты_[счёт].pdf",
            "СНИЛС_112-233-445_95.pdf": "СНИЛС_[СНИЛС].pdf",
            "contacts_+79123456789.vcf": "contacts_[телефон].vcf",
            "ИНН_500100732259.pdf": "ИНН_[реквизиты].pdf",
            "invoice_DE89370400440532013000.pdf": "invoice_[счёт].pdf",
            "ivan.petrov@example.com_договор.pdf": "[email]_договор.pdf",
        }
        for src, want in cases.items():
            self.assertEqual(tc.redact(src), want, src)
        self.assertEqual(tc.redact("договор_ivan.petrov@example.com.pdf", filename=True), "договор [email].pdf")
        self.assertEqual(tc.redact("Паспорт_4510_123456.pdf", filename=True), "Паспорт [паспорт].pdf")
        self.assertEqual(tc.redact("Бриф_курс_A2.docx", filename=True), "Бриф_курс_A2.docx")    # nothing to hide

    def test_no_over_masking(self):
        keep = [
            "Пароль: пришлю отдельно", "пароль: в письме", "Логин: тот же", "Логин: как обычно, через Google",
            "Пароль: см. выше", "+12 500 000 подписчиков", "охват +12 345 678 человек", "A" * 40, "a" * 40,
            "пароль от тильды в 10:00 пришлю", "Скинь пароль. Завтра в 10:00 созвон", "доступ: 24/7",
            "токены GPT стоят 10 центов", "Ключевые слова: SEO", "Код доступа пришлю", "10 15 20 25 30 35",
            "7 10 15 20 25 30", "номер заказа 2024031512", "оплата 15 000, 20 000 и 25 000", "версия 1.2.3.4",
        ]
        for text in keep:
            self.assertEqual(tc.redact(text), text)


class TestScoringRegressions(unittest.TestCase):
    FRIEND = ["привет", "как дела", "ахах", "ну да", "го гулять", "скинь фотку", "ок", "спокойной ночи",
              "что делаешь", "в субботу?", "давай", "норм", "пошли в кино", "ты где", "я дома", "устал", "круто"]
    WORKISH = ["купил новую игру", "глянь сайт", "смешной бот", "курс доллара вырос", "оплатил ужин, скинь 1500 р",
               "ок перевёл", "сроки на работе горят", "начальник прислал правки", "делаю презентацию на работе",
               "начальник ждёт отчёт к дедлайну", "бюджет на отпуск 100 тыс", "купил билеты за 12 000 ₽",
               "кинул чек за такси", "договор аренды квартиры продлили", "стоимость ремонта 300 тыс"]
    CLIENT = ["Здравствуйте, нужен курс из 6 модулей", "Пришлите ТЗ", "Стоимость 45 000 ₽", "Предоплата 50%",
              "Перевела аванс", "Договор как с самозанятым", "Сроки 5 недель", "Вот макет", "Внесла правки",
              "Согласовали модуль 2", "Ок", "Спасибо!", "Отлично", "Да", "Посмотрю вечером", "Акт подписан",
              "Оплатила вторую часть 22 500 ₽", "Чек пришлите"]

    def score(self, lines, **kw):
        st = tc.analyze_chat(_chat(_talk(lines, **kw)), {f"user{ME_T[1]}"})
        return st

    def test_long_friend_chat_ranks_below_small_client(self):
        import random
        rnd = random.Random(1)
        client = self.score([rnd.choice(self.CLIENT) for _ in range(40)], step_min=600)
        for n, share in ((2000, 0.02), (6000, 0.02), (2000, 0.04)):
            lines = [rnd.choice(self.WORKISH) if rnd.random() < share else rnd.choice(self.FRIEND) for _ in range(n)]
            friend = self.score(lines)
            self.assertLess(friend["score"], client["score"], (n, share))

    def test_cost_splitting_group_counts_money_half(self):
        people = [(f"Путник {i}", 500 + i) for i in range(6)]
        lines = ["Билеты по 12 000 ₽", "Кто оплатил трансфер? 4 500 ₽", "Я перевела 6 000", "Скинул деньги",
                 "Бюджет на еду 3 000 р в день", "Чек за бензин 2 300 руб"]
        t = tc.dt.datetime(2023, 6, 1, 9)
        msgs = [_msg(i + 1, t + tc.dt.timedelta(minutes=30 * i), people[i % 6], lines[i % len(lines)]) for i in range(120)]
        trip = tc.analyze_chat(_chat(msgs, "Сочи", "private_group"), {"user1000000001"})
        two = [_msg(m["id"], tc.dt.datetime(2023, 6, 1, 9) + tc.dt.timedelta(minutes=30 * i),
                    people[i % 2], m["text"]) for i, m in enumerate(msgs)]
        client_group = tc.analyze_chat(_chat(two, "Школа", "private_group"), {"user1000000001"})
        self.assertGreaterEqual(len(trip["money_senders"]), 4)
        self.assertLess(trip["score"], client_group["score"] * 0.8)

    def test_voice_and_call_heavy_chat_gets_its_own_section(self):
        t = tc.dt.datetime(2024, 1, 1, 10)
        msgs = []
        for i in range(90):
            t += tc.dt.timedelta(minutes=30)
            if i % 3 == 0:
                msgs.append(_msg(i, t, PEER_T, "", media_type="voice_message", file="(File not included.)",
                                 duration_seconds=104))
            elif i % 22 == 1:
                msgs.append({"id": i, "type": "service", "date": t.isoformat(), "actor_id": "user1000000001",
                             "action": "phone_call", "duration_seconds": 1500})
            else:
                msgs.append(_msg(i, t, ME_T if i % 2 else PEER_T, ["ок", "скинул", "давай созвонимся"][i % 3]))
        st = tc.analyze_chat(_chat(msgs), {"user1000000001"})
        self.assertFalse(st["signal"])
        self.assertTrue(st["voice_signal"])
        out = fresh("voice-section")
        out.mkdir(parents=True)
        (out / "result.json").write_text(json.dumps({"name": "Тест", "type": "personal_chat", "id": 777,
                                                     "messages": msgs}, ensure_ascii=False), encoding="utf-8")
        code, so, se = run_main("find", out, "--out", out / "o", "--no-open", "--me", ME_T[0])
        self.assertEqual(code, 0, se)
        page = read(out / "o" / "candidates.html")
        self.assertIn('data-section="voice"', page)
        self.assertIn("Почти без текста", page)
        self.assertIn('data-main="0"', page.split('data-section="voice"', 1)[1])    # top-10 does not tick it
        self.assertIn("почти без слов о работе", so)

    def test_language_hint_never_forces_english(self):
        russian = ["Привет, глянь ошибку", "Сейчас посмотрю, что там с ботом", "Скинь лог целиком"] * 3
        log = ("Traceback (most recent call last): File \"/usr/lib/python3/site-packages/telegram/ext/updater.py\", "
               "line 42, in start_polling raise NetworkError(\"Connection reset by peer\") https://github.com/example/bot")
        st = self.score([x for pair in zip(russian, [log] * len(russian)) for x in pair])
        self.assertNotEqual(st["lang"], "en")
        self.assertIsNone(tc.chat_language(10, 990))
        self.assertEqual(tc.chat_language(900, 100), "ru")

    def test_nda_counted_before_since_and_named(self):
        old = tc.dt.datetime(2021, 3, 1, 10)
        msgs = [_msg(i + 1, old + tc.dt.timedelta(days=i), PEER_T, "Созвон по Tixu") for i in range(3)]
        msgs += [_msg(10 + i, tc.dt.datetime(2023, 5, 1, 10) + tc.dt.timedelta(hours=i), PEER_T,
                      "ТЗ готово, дедлайн пятница, правки внесла") for i in range(5)]
        st = tc.analyze_chat(_chat(msgs), {"user1000000001"}, since=tc.dt.datetime(2022, 1, 1))
        self.assertEqual(st["messages"], 5)
        self.assertTrue(st["nda"])
        self.assertEqual(tc.nda_names(st), ["Tixu"])
        rx = tc.make_nda_re(["Skillbox"])
        for text in ("Эдьюсон", "Эдъюсон", "Едюсон", "Едусон", "мой_tixu", "Skillbox.ru"):
            self.assertTrue(rx.search(text), text)
        href = _msg(1, old, PEER_T, [{"type": "text_link", "text": "тут", "href": "https://eduson.tv/x"}] * 3)
        self.assertEqual(tc.analyze_chat(_chat([href]), set())["nda_hits"], 3)

    def test_full_peer_name_and_deleted_account(self):
        st = self.score(["Нужен лендинг, оплата 10 000 ₽", "Ок"])
        self.assertEqual(st["title"], "Тест Собеседник")
        deleted = tc.Chat({"type": "personal_chat", "id": 5, "messages": []}, Path("."), Path("r.json"))
        self.assertEqual(deleted.name, "Удалённый аккаунт")


class TestFindRegressions(unittest.TestCase):
    def test_extra_nda_words_reach_report_command_and_build(self):
        out = fresh("nda-extra")
        code, so, se = run_main("find", FX["full"], "--out", out, "--no-open", "--nda", "Skillbox, Школа")
        self.assertEqual(code, 0, se)
        page = read(out / "candidates.html")
        self.assertIn("упоминается Школа (в названии чата)", page)
        self.assertNotIn("упоминается Tixu или Eduson", page)
        data = json.loads(read(out / "candidates.json"))
        self.assertEqual(shlex.split(data["command_suffix"])[-2:], ["--nda", "Skillbox, Школа"])
        code, so, se = run_main(*shlex.split(data["command_prefix"] + SCHOOL + data["command_suffix"])[3:],
                                "--engine", "fake")
        self.assertEqual(code, 0, se)
        ws = out / "claude"
        dossier = read(ws / "dossiers" / "01-shkola-primer-zapusk-kursa.md")
        self.assertIn("- NDA: упоминается Школа (в названии чата)", dossier)
        self.assertIn("проверь: Школа", read(ws / "dossiers" / "00-сводка.md"))
        self.assertIn("связанной со словами: Skillbox, Школа", read(ws / "CLAUDE.md"))
        # a later build without --nda remembers the words
        code, _, se = run_main("build", FX["full"], "--chats", SCHOOL, "--out", out, "--engine", "fake")
        self.assertIn("Skillbox, Школа", read(ws / "CLAUDE.md"))

    def test_search_finds_surname_and_scores_use_comma(self):
        out = fresh("find-names")
        run_main("find", FX["full"], "--out", out, "--no-open")
        page = read(out / "candidates.html")
        self.assertIn('data-search="Марина Образцова Марина 1000000101"', page)
        self.assertIn(">Александр Первый<", page)
        self.assertIn(">Александр Второй<", page)
        self.assertRegex(page, r"балл \d+,\d")
        self.assertIn("Ничего не нашлось", page)

    def test_ctrl_c_during_find_does_not_talk_about_transcripts(self):
        with mock.patch.object(tc, "analyze_chat", side_effect=KeyboardInterrupt):
            code, _, err = run_main("find", FX["full"], "--out", fresh("ctrlc"), "--no-open")
        self.assertEqual(code, 130)
        self.assertIn("Остановлено.", err)
        self.assertNotIn("расшифровки", err)

    def test_typing_slips_get_russian_hints(self):
        r = run_cli("find")
        self.assertIn("перетащи папку выгрузки", r.stderr)
        r = run_cli("find", str(BASE / "Telegram"), "Desktop/DataExport_2026-10-11")
        self.assertIn("в пути к папке есть пробел", r.stderr)
        r = run_cli("build", "--help")
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("usage:", r.stdout)
        self.assertNotIn("show this help", r.stdout)
        self.assertIn("Запуск:", r.stdout)


class TestLoadRegressions(unittest.TestCase):
    def test_duplicate_tie_prefers_copy_with_voice_on_disk(self):
        d = fresh("reexport")
        old, new = d / "ChatExport_2026-10-11", d / "ChatExport_2026-10-11 (1)"
        shutil.copytree(FX["single"], new)
        shutil.copytree(FX["single"], old)
        p = old / "result.json"
        data = json.loads(read(p))
        for m in data["messages"]:
            if "media_type" in m:
                m["file"] = mf.NOT_INCLUDED
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        shutil.rmtree(old / "voice_messages")
        exp = tc.load_export(str(d))
        self.assertEqual(exp.duplicates, 1)
        self.assertEqual(exp.chats[0].base, new)
        # and the other way round: the later copy without voice notes loses
        shutil.rmtree(d)
        shutil.copytree(FX["single"], old)
        shutil.copytree(FX["single"], new)
        (new / "result.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(tc.load_export(str(d)).chats[0].base, old)

    def test_broken_export_among_several_is_skipped(self):
        d = fresh("parent2")
        shutil.copytree(FX["single"], d / "ChatExport_2026-10-11")
        (d / "ChatExport_2026-10-10").mkdir()
        (d / "ChatExport_2026-10-10" / "result.json").write_text('{"name": "x", "messages": [', encoding="utf-8")
        exp = tc.load_export(str(d))
        self.assertEqual(len(exp.chats), 1)
        self.assertEqual(len(exp.warnings), 1)
        self.assertIn("ChatExport_2026-10-10", exp.warnings[0])

    def test_non_numeric_chat_ids_never_reach_the_shell(self):
        d = fresh("evil-id")
        d.mkdir()
        (d / "result.json").write_text(json.dumps({"name": "x", "type": "personal_chat", "id": "1;touch /tmp/x",
                                                   "messages": []}), encoding="utf-8")
        chat = tc.load_export(str(d)).chats[0]
        self.assertRegex(chat.key, r"^x\d+$")


class TestBuildRegressions(unittest.TestCase):
    def test_workspace_for_claude_holds_no_report_and_no_cache(self):
        out = fresh("workspace")
        run_main("find", FX["full"], "--out", out, "--no-open")
        code, so, se = run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(code, 0, se)
        ws = out / "claude"
        self.assertEqual(sorted(p.name for p in ws.iterdir()), [".claude", "CLAUDE.md", "dossiers"])
        self.assertTrue((out / "candidates.json").is_file() and (out / ".cache" / "transcripts.json").is_file())
        for folder in (ws, out):
            deny = json.loads(read(folder / ".claude" / "settings.json"))["permissions"]["deny"]
            self.assertIn(f"Read(/{out.as_posix()}/candidates.json)", deny)
            self.assertIn(f"Read(/{out.as_posix()}/.cache/**)", deny)
        self.assertIn(f"cd {tc.sh_quote(str(ws))}", so)
        # his own settings are never overwritten
        (ws / ".claude" / "settings.json").write_text("{}", encoding="utf-8")
        run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(read(ws / ".claude" / "settings.json"), "{}")

    def test_cache_survives_a_new_export_with_renumbered_folders(self):
        out = fresh("renumber")
        new = fresh("renumber-export") / "DataExport_2026-10-18"
        shutil.copytree(FX["full"], new)
        os.rename(new / "chats" / "chat_01", new / "chats" / "chat_17")
        raw = read(new / "result.json").replace("chats/chat_01/", "chats/chat_17/")
        (new / "result.json").write_text(raw, encoding="utf-8")
        tc.FakeEngine.calls = 0
        run_main("build", FX["full"], "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(tc.FakeEngine.calls, 4)
        tc.FakeEngine.calls = 0
        code, so, se = run_main("build", new, "--chats", MARINA, "--out", out, "--engine", "fake")
        self.assertEqual(code, 0, se)
        self.assertEqual(tc.FakeEngine.calls, 0)
        self.assertIn("уже расшифровано раньше 4", so)

    def test_explicit_lang_retranscribes_other_language(self):
        out = fresh("lang")
        run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--engine", "fake")
        tc.FakeEngine.calls = 0
        run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--engine", "fake", "--lang", "ru")
        self.assertEqual(tc.FakeEngine.calls, 2)
        tc.FakeEngine.calls = 0
        run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--engine", "fake", "--lang", "ru")
        self.assertEqual(tc.FakeEngine.calls, 0)

    def test_decode_errors_cached_engine_errors_retried(self):
        out = fresh("errors-cache")
        real = tc.FakeEngine.transcribe_file

        def flaky(self, path, language, duration):
            if Path(path).suffix == ".ogg":
                raise tc.DecodeError("InvalidDataError: broken file")
            raise RuntimeError("engine exploded")

        with mock.patch.object(tc.FakeEngine, "transcribe_file", flaky):
            code, so, se = run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--engine", "fake")
        self.assertEqual(code, 0, se)
        self.assertIn("Не читается файлов: 1.", so)
        self.assertIn("ошибка распознавания", so)
        cache = json.loads(read(out / ".cache" / "transcripts.json"))
        self.assertEqual([e["status"] for e in cache.values()], ["error"])
        t = read(out / "claude" / "dossiers" / "01-darya.md")
        self.assertIn("[голосовое 0:05] (файл не читается)", t)
        self.assertIn("[видеосообщение 0:03] (не расшифровано: ошибка распознавания)", t)
        tc.FakeEngine.calls = 0
        with mock.patch.object(tc.FakeEngine, "transcribe_file", real):
            run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--engine", "fake")
        self.assertEqual(tc.FakeEngine.calls, 1)                 # only the engine failure is retried

    def test_money_from_voice_reaches_the_header(self):
        out = fresh("voice-money")
        items = tc.voice_items(tc.load_export(str(FX["single"])).chats[0])
        (out / ".cache").mkdir(parents=True)
        tc.atomic_write_json(out / ".cache" / "transcripts.json",
                             {items[0].key: {"text": "Давайте за 40 000 рублей, аванс половина", "engine": "mlx"}})
        code, _, se = run_main("build", FX["single"], "--chats", "1000000111", "--out", out, "--no-voice")
        self.assertEqual(code, 0, se)
        t = read(out / "claude" / "dossiers" / "01-darya.md")
        self.assertIn("«40 000 рублей» (из голосового, проверь)", t)

    def test_reply_to_another_chat_is_not_quoted(self):
        t = tc.dt.datetime(2024, 1, 1, 10)
        msgs = [_msg(5, t, PEER_T, "Привет"),
                _msg(6, t + tc.dt.timedelta(minutes=1), ME_T, "Ответ", reply_to_message_id=5,
                     reply_to_peer_id="channel123")]
        units = tc.render_conversation(_chat(msgs), {"user1000000001"}, {}, tc.redact)
        text = "\n".join(u[1] for u in units)
        self.assertIn("(в ответ на сообщение из другого чата) Ответ", text)
        self.assertNotIn("«Привет»", text)

    def test_part_names_and_empty_chat(self):
        self.assertEqual(tc.dossier_names(3, "igor", 2), ["03-igor.part1.md", "03-igor.part2.md"])
        names = tc.dossier_names(1, "big", 12)
        self.assertEqual(names[0], "01-big.part01.md")
        self.assertEqual(sorted(names), names)
        empty = tc.Chat({"name": "Пусто", "type": "personal_chat", "id": 9, "messages": []}, Path("."), Path("r"))
        st = tc.analyze_chat(empty, set())
        header = tc.render_header(empty, st, 1, "Я", {}, tc.redact, True)
        self.assertIn("- Период: сообщений с датой нет", header)
        self.assertNotIn("? – ?", header)

    def test_progress_prints_the_last_line_once(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            p = tc.Progress(10, 100)
            for n in range(1, 11):
                p.show(n, n * 10)
            p.show(10, 100, final=True)
        self.assertEqual(buf.getvalue().count("[10/10]"), 1)


class TestGhostRegressions(unittest.TestCase):
    def test_ghost_segment_before_real_speech(self):
        segs = [" Субтитры сделал DimaTorzok", " Привет, это важное голосовое про оплату 45 000."]
        self.assertEqual(tc.join_segments(segs), "Привет, это важное голосовое про оплату 45 000.")
        self.assertEqual(tc.clean_hallucinations("Субтитры создавал DimaTorzok Привет как дела"), "Привет как дела")
        self.assertEqual(tc.clean_hallucinations("Субтитры сделаны для курса про маркетинг, который мы обсуждали вчера"),
                         "Субтитры сделаны для курса про маркетинг, который мы обсуждали вчера")
        self.assertTrue(tc.is_doubtful("Спасибо!"))
        self.assertFalse(tc.is_doubtful("Спасибо, всё получил"))

    def test_both_engines_keep_speech_after_a_ghost_segment(self):
        rec = {}
        mods = _stub_modules(rec)

        def mlx_ghost_first(audio, **kw):
            return {"text": "x", "language": "ru", "segments": [
                {"text": " Субтитры сделал DimaTorzok", "no_speech_prob": 0.2, "avg_logprob": -0.4},
                {"text": " Привет, это про оплату.", "no_speech_prob": 0.1, "avg_logprob": -0.2}]}

        mods["mlx_whisper"].transcribe = mlx_ghost_first
        Segment = type("Segment", (), {})

        def seg(text):
            s = Segment()
            s.text, s.no_speech_prob, s.avg_logprob = text, 0.1, -0.2
            return s

        fw_model = mods["faster_whisper"].WhisperModel
        fw_model.transcribe = lambda self, audio, **kw: (iter([seg(" Субтитры сделал DimaTorzok"),
                                                               seg(" Hello, about the invoice.")]), None)
        with mock.patch.dict(sys.modules, mods), mock.patch.object(tc, "decode_audio", lambda p: FakeAudio()), \
                mock.patch.object(tc, "is_silent", lambda a: False):
            mlx = tc.MlxEngine("turbo")
            mlx.path = "x"
            self.assertEqual(mlx.transcribe_file("a.ogg", "ru", 4)[0], "Привет, это про оплату.")
            fw = tc.FasterEngine()
            fw.whisper = fw_model("x")
            self.assertEqual(fw.transcribe_file("a.ogg", None, 4)[0], "Hello, about the invoice.")

    def test_decode_failure_is_a_decode_error(self):
        def boom(path):
            raise ValueError("bad header")
        with mock.patch.object(tc, "decode_audio", boom):
            with self.assertRaises(tc.DecodeError):
                tc.FasterEngine().transcribe_file("a.ogg", None, 3)


# ----------------------------------------------------------------------------- packaging and Python 3.9

def _python39():
    exe = shutil.which("python3.9")
    if exe:
        return exe
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if Path(uv).is_file():
        r = subprocess.run([uv, "python", "find", "3.9"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return None


class TestPackaging(unittest.TestCase):
    def test_pep723_header(self):
        src = read(TOOL)
        m = re.search(r"^# /// script\n((?:#.*\n)+?)# ///$", src, re.M)
        self.assertIsNotNone(m)
        block = "\n".join(line[2:] for line in m.group(1).splitlines())
        self.assertIn('requires-python = ">=3.10,<3.14"', block)
        deps = re.findall(r'"([^"]+)"', block.split("dependencies", 1)[1])
        self.assertEqual(deps, [
            "av>=12", "numpy",
            "mlx-whisper>=0.4.3; sys_platform == 'darwin' and platform_machine == 'arm64'",
            "faster-whisper>=1.2.1; sys_platform != 'darwin' or platform_machine != 'arm64'",
        ])

    def test_syntax_is_python39(self):
        ast.parse(read(TOOL), feature_version=(3, 9))

    def test_stdlib_only_at_import(self):
        r = subprocess.run([sys.executable, "-c",
                            "import sys; sys.path.insert(0, sys.argv[1]); import tg_cases; "
                            "bad = [m for m in ('av', 'numpy', 'mlx_whisper', 'faster_whisper') if m in sys.modules]; "
                            "print(bad)", str(TOOL.parent)], capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), "[]", r.stderr)

    def test_find_and_build_no_voice_on_python39(self):
        py = _python39()
        if not py:
            self.skipTest("python3.9 not available")
        out = fresh("py39")
        r = run_cli("find", FX["full"], "--out", out, "--no-open", python=py)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((out / "candidates.html").is_file())
        r = run_cli("build", FX["full"], "--chats", f"{MARINA},{IGOR},{ANNA}", "--out", out, "--no-voice", python=py)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((out / "claude" / "dossiers" / "02-igor.part2.md").is_file())
        r = run_cli("build", FX["full"], "--chats", MARINA, "--out", out, python=py)
        self.assertEqual(r.returncode, 2)
        self.assertIn("--no-voice", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main()
