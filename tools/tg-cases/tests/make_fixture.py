#!/usr/bin/env python3
"""Synthetic Telegram Desktop JSON exports for the tg_cases tests.

Every person, company, phone, card and key here is fake. Secrets are assembled at runtime
so that no provider-shaped token appears in the source of this public repository.

    python3 make_fixture.py OUT_DIR

Creates:
    OUT_DIR/full/DataExport_2026-10-11/result.json      full export (Settings, Export Telegram data)
    OUT_DIR/single/ChatExport_2026-10-11/result.json    one chat (Export chat history)
    OUT_DIR/multi/ChatExport_2026-10-11/result.json     parent folder with two single-chat exports
    OUT_DIR/multi/ChatExport_2026-10-11 (1)/result.json
    OUT_DIR/html_only/ChatExport_2026-10-11/messages.html
Voice notes and round videos are real .ogg/.mp4 files made with ffmpeg (speech is cut from the
portfolio reel, the rest is a tone or silence). Without ffmpeg they are dummy bytes.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
REEL = REPO / "assets" / "reels" / "reel-c3.mp4"

ME = ("Алексей Пример", 1000000001)
MARINA = ("Марина Образцова", 1000000101)
JOHN = ("John Sample", 1000000102)
PETYA = ("Пётр Друганов", 1000000103)
KATYA = ("Катя Коллегова", 1000000105)
ANNA = ("Анна Заглушкина", 1000000106)
SASHA1 = ("Александр Первый", 1000000107)
SASHA2 = ("Александр Второй", 1000000108)
IGOR = ("Игорь Длинный", 1000000109)
MAMA = ("Мама Тестовая", 1000000110)
DARIA = ("Дарья Тестовая", 1000000111)
VIKTOR = ("Виктор Проверкин", 1000000112)
OLGA = ("Ольга Тестова", 1000000121)
SERGEY = ("Сергей Примеров", 1000000122)
COLLEAGUE1 = ("Коллега Один", 1000000131)
COLLEAGUE2 = ("Коллега Два", 1000000132)
DESIGNER = ("Дизайнер Тестов", 1000000141)

NOT_INCLUDED = "(File not included. Change data exporting settings to download.)"
UNAVAILABLE = "(File unavailable, please try again later)"


def fake_secrets() -> dict:
    """Clearly fake values in the right shape for the redaction rules."""
    digest = base64.b64encode(hashlib.sha256(b"tg-cases fixture").digest()).decode()
    random_like = digest.replace("+", "x").replace("/", "y").rstrip("=")      # 43 chars, mixed case
    return {
        "anthropic": "sk-" + "ant-" + "api03-" + "ONLYFORTESTS-" + "abcdef0123456789" * 3,
        "github": "gh" + "p_" + "TESTONLY" + "0123456789abcdef" * 2,
        "bot": "1234567890" + ":" + "AA" + "F" * 33,
        "random": random_like,
        "password": "Kx9#mPq2Lz",
        "card": "4111 1111 1111 1111",
        "email": "marina.obraztsova@example.com",
        "phone": "+7 (900) 000-00-00",
        "iban": "DE89 3704 0044 0532 0130 00",
        "account": "40817810" + "0" * 12,
        "file_email": "sasha.test@example.com",
    }


# ----------------------------------------------------------------------------- media

class Media:
    """Makes small real audio/video files once and copies them where needed."""

    def __init__(self, cache: Path):
        self.cache = cache
        self.cache.mkdir(parents=True, exist_ok=True)
        self.ffmpeg = shutil.which("ffmpeg")
        self.made = {}

    def _run(self, args, out: Path) -> bool:
        if not self.ffmpeg:
            return False
        r = subprocess.run([self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y"] + args + [str(out)],
                           capture_output=True)
        return r.returncode == 0 and out.is_file()

    def source(self, kind: str) -> Path:
        if kind in self.made:
            return self.made[kind]
        out = self.cache / {"speech": "speech.ogg", "speech2": "speech2.ogg", "tone": "tone.ogg",
                            "silence": "silence.ogg", "round": "round.mp4", "round_mute": "round_mute.mp4"}[kind]
        ok = out.is_file()
        if not ok and REEL.is_file():
            if kind == "speech":
                ok = self._run(["-ss", "2", "-t", "6", "-i", str(REEL), "-vn", "-ac", "1", "-ar", "48000",
                                "-c:a", "libopus", "-b:a", "24k"], out)
            elif kind == "speech2":
                ok = self._run(["-ss", "10", "-t", "5", "-i", str(REEL), "-vn", "-ac", "1", "-ar", "48000",
                                "-c:a", "libopus", "-b:a", "24k"], out)
            elif kind == "round":
                ok = self._run(["-ss", "4", "-t", "4", "-i", str(REEL), "-vf",
                                "scale=384:384:force_original_aspect_ratio=increase,crop=384:384",
                                "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-ar", "44100",
                                "-ac", "2"], out)
            elif kind == "round_mute":
                ok = self._run(["-ss", "4", "-t", "3", "-i", str(REEL), "-vf",
                                "scale=384:384:force_original_aspect_ratio=increase,crop=384:384",
                                "-c:v", "libx264", "-preset", "ultrafast", "-an"], out)
        if not ok and kind == "tone":
            ok = self._run(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "1",
                            "-c:a", "libopus", "-b:a", "24k"], out)
        if not ok and kind == "silence":
            ok = self._run(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "2",
                            "-c:a", "libopus", "-b:a", "24k"], out)
        if not ok:
            out.write_bytes(b"not real media: ffmpeg or the reel is missing " + kind.encode())
        self.made[kind] = out
        return out


# ----------------------------------------------------------------------------- chat builder

def text_fields(text):
    """Telegram writes `text` as a string or a mixed list; `text_entities` is always a list."""
    if isinstance(text, str):
        return text, ([{"type": "plain", "text": text}] if text else [])
    ents = []
    for part in text:
        ents.append({"type": "plain", "text": part} if isinstance(part, str) else dict(part))
    return text, ents


class ChatBuilder:
    def __init__(self, export_root: Path, prefix: str, name, ctype: str, cid: int, media: Media):
        self.root, self.prefix, self.media = export_root, prefix, media
        self.chat = {"type": ctype, "id": cid, "messages": []}
        if name is not None:
            self.chat = {"name": name, "type": ctype, "id": cid, "messages": []}
        self.next_id = 1
        self.counters = {"audio": 0, "file": 0, "photo": 0}

    def _base(self, when: dt.datetime, mtype="message") -> dict:
        m = {"id": self.next_id, "type": mtype, "date": when.strftime("%Y-%m-%dT%H:%M:%S"),
             "date_unixtime": str(int(when.replace(tzinfo=dt.timezone.utc).timestamp()))}
        self.next_id += 1
        return m

    def msg(self, when, who, text="", **extra) -> dict:
        m = self._base(when)
        name, uid = who
        m["from"] = name
        m["from_id"] = f"user{uid}" if isinstance(uid, int) else uid
        m.update(extra)
        m["text"], m["text_entities"] = text_fields(text)
        self.chat["messages"].append(m)
        return m

    def service(self, when, who, action, **extra) -> dict:
        m = self._base(when, "service")
        m["actor"], m["actor_id"] = who[0], f"user{who[1]}"
        m["action"] = action
        m.update(extra)
        m["text"], m["text_entities"] = "", []
        self.chat["messages"].append(m)
        return m

    def _stamp(self, when):
        return when.strftime("%d-%m-%Y_%H-%M-%S")

    def voice(self, when, who, seconds, source="tone", path_override=None, text=""):
        self.counters["audio"] += 1
        if path_override is not None:
            rel = path_override
        else:
            rel = f"{self.prefix}voice_messages/audio_{self.counters['audio']}@{self._stamp(when)}.ogg"
            dst = self.root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.media.source(source), dst)
        size = (self.root / rel).stat().st_size if (self.root / rel).is_file() else 23456
        return self.msg(when, who, text, file=rel, file_size=size, media_type="voice_message",
                        mime_type="audio/ogg", duration_seconds=seconds)

    def round(self, when, who, seconds, source="round", path_override=None):
        self.counters["file"] += 1
        if path_override is not None:
            rel, thumb = path_override, path_override
        else:
            rel = f"{self.prefix}round_video_messages/file_{self.counters['file']}@{self._stamp(when)}.mp4"
            thumb = rel + "_thumb.jpg"
            dst = self.root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.media.source(source), dst)
        size = (self.root / rel).stat().st_size if (self.root / rel).is_file() else 812345
        return self.msg(when, who, "", file=rel, file_size=size, thumbnail=thumb, thumbnail_file_size=5123,
                        media_type="video_message", mime_type="video/mp4", duration_seconds=seconds,
                        width=384, height=384)

    def document(self, when, who, name, text=""):
        return self.msg(when, who, text, file=NOT_INCLUDED, file_name=name, file_size=34567,
                        mime_type="application/octet-stream")

    def photo(self, when, who, text=""):
        return self.msg(when, who, text, photo=NOT_INCLUDED, photo_file_size=123456, width=1280, height=960)

    def sticker(self, when, who, emoji):
        return self.msg(when, who, "", file=NOT_INCLUDED, file_name="sticker.webp", file_size=23000,
                        thumbnail=NOT_INCLUDED, thumbnail_file_size=4000, media_type="sticker",
                        sticker_emoji=emoji, mime_type="image/webp", width=512, height=512)

    def call(self, when, who, seconds=0, reason="hangup"):
        extra = {"discard_reason": reason}
        if seconds:
            extra["duration_seconds"] = seconds
        return self.service(when, who, "phone_call", **extra)


def T(day: str, hhmm: str) -> dt.datetime:
    return dt.datetime.strptime(f"{day} {hhmm}", "%Y-%m-%d %H:%M")


# ----------------------------------------------------------------------------- chats

def chat_marina(b: ChatBuilder, s: dict):
    """Clear paid freelance job: online English school course."""
    d = "2026-03-02"
    b.msg(T(d, "10:15"), MARINA, "Здравствуйте! Мне посоветовали вас как методолога. Нам нужен курс для онлайн-школы "
          "английского: 6 модулей для взрослых, уровень A2.")
    b.msg(T(d, "10:16"), MARINA, "Бриф пришлю сегодня, ТЗ тоже.")
    b.msg(T(d, "10:40"), ME, "Добрый день! Да, давайте. Пришлите бриф, посмотрю и вернусь с оценкой сроков и стоимости.")
    b.document(T(d, "12:05"), MARINA, "Бриф_курс_A2.docx", "Вот бриф и ТЗ")
    b.voice(T(d, "12:07"), MARINA, 6, "speech")
    d = "2026-03-03"
    b.msg(T(d, "09:30"), ME, "Посмотрел ТЗ. Стоимость 45 000 ₽ за 6 модулей, срок 5 недель. Работаю как самозанятый, по договору.")
    b.msg(T(d, "09:31"), ME, "Если удобно, созвонимся сегодня.")
    b.msg(T(d, "09:50"), MARINA, "Подходит. Предоплата 50%?")
    b.msg(T(d, "09:55"), ME, f"Да, аванс 22 500 руб., остальное после сдачи. Реквизиты: карта {s['card']}, получатель Алексей П.")
    b.call(T(d, "11:00"), MARINA, 754)
    b.msg(T(d, "13:20"), MARINA, "Перевела аванс, пришлите чек, пожалуйста")
    b.msg(T(d, "13:25"), ME, f"Чек отправил на почту {s['email']}")
    b.msg(T(d, "13:26"), MARINA, "На вебинаре вчера упоминали Eduson.")
    d = "2026-03-05"
    m_prog = b.msg(T(d, "18:00"), ME, [
        "Вот ", {"type": "text_link", "text": "программа курса", "href": "https://docs.google.com/document/d/EXAMPLEdoc123/edit"},
        ", а макет урока в ", {"type": "link", "text": "https://www.figma.com/file/EXAMPLE/lesson-mockup"},
        ". ", {"type": "bold", "text": "Дедлайн"}, " первого модуля 20 марта.",
    ])
    b.msg(T(d, "19:10"), MARINA, "Посмотрела, есть правки по модулю 2", reply_to_message_id=m_prog["id"])
    b.round(T(d, "19:12"), MARINA, 4)
    b.msg(T(d, "19:30"), MARINA, f"Доступ к GetCourse: логин: school-admin, пароль: {s['password']}")
    b.msg(T(d, "19:35"), ME, f"Спасибо, зашёл. Мой телефон для связи {s['phone']}")
    b.msg(T(d, "19:40"), MARINA, f"Для бота поддержки вот ключ API: {s['anthropic']}")
    b.sticker(T(d, "19:41"), ME, "👍")
    d = "2026-03-12"
    b.photo(T(d, "11:00"), MARINA, "Скрин из LMS, так выглядит урок у учеников")
    b.msg(T(d, "11:05"), MARINA, "Отзыв ученика: уроки понятные, задания короткие", forwarded_from="Ольга Тестова")
    b.call(T(d, "11:30"), MARINA, 0, "missed")
    b.voice(T(d, "12:00"), ME, 3, "tone")
    b.msg(T(d, "12:01"), ME, "Перезвоню через час, я на встрече")
    d = "2026-03-20"
    b.msg(T(d, "17:00"), ME, "Сдал модуль 1 и модуль 2. Правки внёс.")
    b.msg(T(d, "17:02"), ME, "Там 8 уроков и 2 теста.")
    b.msg(T(d, "17:30"), MARINA, "Супер, спасибо! Ученикам заходит")
    b.voice(T(d, "17:31"), MARINA, 2, "silence")
    d = "2026-04-07"
    b.msg(T(d, "10:00"), ME, "Модули 3-6 готовы, проверьте, пожалуйста. Доработки по сценариям вебинара тоже.")
    b.msg(T(d, "15:00"), MARINA, "Всё приняли. Финальная оплата 22 500 ₽ отправлена, акт подписали.")
    b.msg(T(d, "15:05"), ME, "Спасибо! Было приятно работать. Если нужен будет тренажёр для разговорной практики, пишите.")
    b.msg(T(d, "15:06"), MARINA, "Обязательно\x07 напишу")      # control char: Telegram writes it as \x07


def chat_john(b: ChatBuilder, s: dict):
    d = "2026-05-04"
    b.msg(T(d, "16:00"), JOHN, "Hi! I need a landing page and a short onboarding course for our app. Here is the brief: "
          "https://example.com/brief")
    b.msg(T(d, "16:20"), ME, "Hi John. What is the budget and the deadline?")
    b.msg(T(d, "16:25"), JOHN, "Budget is $1,200, deadline is the end of May.")
    b.msg(T(d, "16:30"), ME, "Works for me. I'll send a contract and an invoice today.")
    b.voice(T(d, "16:40"), JOHN, 3, "tone")
    b.call(T(d, "17:00"), ME, 1800)
    d = "2026-05-20"
    b.msg(T(d, "12:00"), JOHN, "Feedback on the prototype: looks great, two small revisions.")
    b.msg(T(d, "12:10"), JOHN, "Paid the invoice today. Thanks!")


def chat_petya(b: ChatBuilder, s: dict):
    """A friend: long casual chat with a little money talk about splitting a bill."""
    lines = [
        (PETYA, "Го в бар в пятницу?"), (ME, "Давай, после восьми"), (PETYA, "Смотрел вчера матч?"),
        (ME, "Ага, нервный был"), (PETYA, "Ахаха, видел мем про кота?"), (ME, "Скинь"),
        (PETYA, "Курс доллара опять вырос"), (ME, "В курсе, жесть"), (PETYA, "Как выходные?"),
        (ME, "Норм, съездили на дачу"), (PETYA, "Привет маме"), (ME, "Передам"),
    ]
    day = dt.datetime(2025, 6, 1, 20, 0)
    for i in range(84):
        who, text = lines[i % len(lines)]
        b.msg(day + dt.timedelta(days=i * 3, minutes=i), who, text)
        if i % 17 == 5:
            b.voice(day + dt.timedelta(days=i * 3, minutes=i + 1), who, 2, "silence")
    t = dt.datetime(2026, 2, 14, 23, 0)
    b.msg(t, PETYA, "Скинь 1 500 за пиццу, плиз")
    b.msg(t + dt.timedelta(minutes=5), ME, "Перевёл")


def chat_tixu_group(b: ChatBuilder, s: dict):
    """An NDA work chat: the word is in its name. Content is generic on purpose (public repository)."""
    d = "2026-01-15"
    b.service(T(d, "09:00"), COLLEAGUE1, "create_group", title="Tixu: рабочий чат", members=[ME[0], COLLEAGUE2[0]])
    b.msg(T(d, "09:05"), COLLEAGUE1, "ТЗ на урок 14 в папке. Дедлайн пятница.")
    b.msg(T(d, "09:10"), ME, "Беру модуль 3, сценарий урока скину к среде.")
    b.msg(T(d, "11:00"), COLLEAGUE2, "Правки внесла.")
    b.msg(T(d, "11:30"), COLLEAGUE1, "Созвон в четверг.")


def chat_katya(b: ChatBuilder, s: dict):
    """NDA by mentions in the messages (not in the name). Neutral sentences only."""
    d = "2026-02-02"
    b.msg(T(d, "10:00"), KATYA, "Привет! Обсудим тиксу завтра?")
    b.msg(T(d, "10:05"), ME, "Давай. ТЗ на курс по промптам посмотрю до дедлайна.")
    b.msg(T(d, "10:06"), KATYA, "Ок, про Тиксу напишу вечером")
    b.msg(T(d, "10:10"), ME, "Ок, поправлю модуль")
    b.msg(T(d, "12:00"), KATYA, "Ссылку на чат Тиксу скину")
    b.msg(T(d, "12:01"), KATYA, "Тиксу в 15:00")


def chat_school_group(b: ChatBuilder, s: dict):
    d = "2026-04-10"
    b.service(T(d, "10:00"), OLGA, "create_group", title="Школа Пример: запуск курса", members=[ME[0], SERGEY[0]])
    b.msg(T(d, "10:05"), OLGA, "Всем привет! Здесь обсуждаем запуск курса и сценарии вебинара.")
    b.msg(T(d, "10:20"), SERGEY, "Счёт на 30 000 руб выставили, оплата по акту после сдачи модуля.")
    b.msg(T(d, "10:30"), ME, "Принял. Программу модулей пришлю завтра, макет лендинга на Tilda тоже.")
    b.msg(T(d, "10:31"), ("Удалённый", "user1000000198"), "Сообщение от удалённого аккаунта")
    b.chat["messages"][-1]["from"] = None
    b.msg(T(d, "11:00"), OLGA, "", poll={"question": "Когда созвон?", "closed": False, "total_voters": 3,
                                          "answers": [{"text": "Вторник", "voters": 2, "chosen": True},
                                                      {"text": "Среда", "voters": 1, "chosen": False}]})
    b.service(T(d, "12:00"), OLGA, "invite_members", members=["Новый Участник"])
    b.service(T("2026-04-14", "15:00"), OLGA, "group_call", duration=2400)
    b.chat["messages"].append({"id": b.next_id, "type": "unsupported"})
    b.next_id += 1
    m = b.msg(T("2026-04-15", "09:00"), SERGEY, "")
    m["rich_message"] = {"blocks": [{"text": "Итоги созвона: стоимость модуля согласовали."}]}
    del m["text"]
    del m["text_entities"]


def chat_anna(b: ChatBuilder, s: dict):
    """Voice files that were not exported or vanished from disk."""
    d = "2026-06-01"
    b.msg(T(d, "08:00"), ANNA, "Нужен гайд по нейросетям для мамы, бюджет 15 000 руб.")
    b.voice(T(d, "08:01"), ANNA, 42, path_override=NOT_INCLUDED)
    b.voice(T(d, "08:02"), ANNA, 15, path_override="voice_messages/audio_99@01-06-2026_08-02-00.ogg")
    b.round(T(d, "08:03"), ANNA, 9, path_override=UNAVAILABLE)
    b.msg(T(d, "09:00"), ME, "Сделаю тренажёр с заданиями на её делах. Срок неделя.")


def chat_landing_group(b: ChatBuilder, s: dict):
    d = "2026-07-01"
    b.msg(T(d, "12:00"), DESIGNER, "Сверстаешь лендинг на Tilda? Макет в Figma готов.")
    b.msg(T(d, "12:10"), ME, "Да. Оплата 25к, срок 4 дня.")
    b.msg(T(d, "12:11"), DESIGNER, "Договорились, предоплату перевёл")


def chat_sasha1(b: ChatBuilder, s: dict):
    d = "2026-08-03"
    b.msg(T(d, "10:00"), SASHA1, "Нужен бот для записи на консультации, ТЗ ниже.")
    b.msg(T(d, "10:30"), ME, "Стоимость 60 000 ₽, срок 3 недели.")
    b.msg(T(d, "10:31"), SASHA1, f"Ок. Токен бота: {s['bot']}")


def chat_sasha2(b: ChatBuilder, s: dict):
    d = "2026-08-10"
    b.msg(T(d, "14:00"), SASHA2, "Сделаешь презентацию для вебинара? Бюджет 10 000 руб.")
    b.msg(T(d, "14:05"), ME, "Сделаю, дедлайн среда подходит.")
    # a file name with personal data glued by "_": must be masked in the report and the dossier
    b.document(T(d, "14:06"), SASHA2, f"Реквизиты_{s['file_email']}_{s['card'].replace(' ', '')}.pdf")


def chat_igor(b: ChatBuilder, s: dict):
    """Long project chat: the dossier must be split into parts."""
    phrases = [
        "Посмотрел урок {n}, предлагаю сократить теорию и добавить практическое задание с разбором ошибок.",
        "Согласен, переписываю сценарий урока {n} и обновляю тест в конце модуля, пришлю вечером ссылку.",
        "По уроку {n} есть вопрос: оставляем кейс про магазин или берём пример из жизни ученика постарше?",
        "Оставляем магазин, он понятнее. Сделай, пожалуйста, ещё короткий чек-лист к уроку {n} для повторения.",
    ]
    start = dt.datetime(2026, 1, 10, 9, 0)
    b.msg(start, IGOR, "Привет! Нужна пересборка курса по финансовой грамотности, 40 уроков. ТЗ и бриф в почте. "
          "Бюджет 120 000 руб, оплата по этапам.")
    for i in range(1, 1601):
        who = IGOR if i % 2 else ME
        t = start + dt.timedelta(hours=1 + i * 1.3)
        b.msg(t, who, phrases[i % 4].format(n=1 + i // 40))


def chat_mama(b: ChatBuilder, s: dict):
    d = "2026-03-08"
    b.msg(T(d, "09:00"), MAMA, "С праздником! Как ты?")
    b.msg(T(d, "09:10"), ME, "Спасибо! Нормально, позвоню вечером")
    b.call(T(d, "19:00"), ME, 600)


def chat_saved(b, s):
    b.chat["messages"].append({"id": 1, "type": "message", "date": "2026-01-01T10:00:00", "date_unixtime": "1767261600",
                               "from": ME[0], "from_id": f"user{ME[1]}", "text": "ТЗ для себя: стоимость 1 000 000 руб",
                               "text_entities": []})


def chat_bot(b, s):
    b.msg(T("2026-01-02", "10:00"), ME, [{"type": "bot_command", "text": "/start"}])
    b.msg(T("2026-01-02", "10:00"), ("Example Bot", 1000000199), "Счёт на оплату 990 руб, оплата по ТЗ")


def chat_channel(b, s):
    m = b.msg(T("2026-01-03", "10:00"), ("Новости Примера", "channel3000000301"), "Курс, ТЗ, оплата, дедлайн, договор")
    m["from_id"] = "channel3000000301"


def chat_public_group(b, s):
    b.msg(T("2026-01-04", "10:00"), OLGA, "Ищу методолога: ТЗ, бюджет 50 000 руб, дедлайн через неделю, договор")


def chat_daria(b, s):
    d = "2026-09-01"
    b.msg(T(d, "11:00"), DARIA, "Добрый день! Нужен аудит курса и пути ученика, бюджет 40 000 руб.")
    b.msg(T(d, "11:20"), ME, "Добрый! Пришлите доступ к курсу и ТЗ, оценю сроки.")
    b.voice(T(d, "11:30"), DARIA, 5, "speech2")
    b.round(T(d, "11:31"), DARIA, 3, "round_mute")
    b.msg(T(d, "11:40"), ME, "Готово: разбор на 12 страниц, оплата по счёту.")


def chat_viktor(b, s):
    d = "2026-09-15"
    b.msg(T(d, "10:00"), VIKTOR, "Нужен сайт на Tilda для курса, договор пришлю.")
    b.msg(T(d, "10:15"), ME, "Ок, оплата 70 000 руб двумя частями.")
    b.msg(T(d, "10:16"), VIKTOR, "Договорились")


def chat_team(b, s):
    d = "2026-09-20"
    b.msg(T(d, "10:00"), OLGA, "Команда, тут обсуждаем модули курса и правки.")
    b.msg(T(d, "10:05"), ME, "Беру модуль 2, дедлайн пятница.")
    b.msg(T(d, "10:06"), SERGEY, "Счёт пришлю после созвона.")


# ----------------------------------------------------------------------------- exports

FULL_CHATS = [
    # (builder fn, name, type)  ids come from the person constants or explicit numbers
    (chat_marina, "Марина", "personal_chat", MARINA[1]),
    (chat_john, "John", "personal_chat", JOHN[1]),
    (chat_petya, "Пётр", "personal_chat", PETYA[1]),
    (chat_tixu_group, "Tixu: рабочий чат", "private_supergroup", 2000000201),
    (chat_katya, "Катя", "personal_chat", KATYA[1]),
    (chat_school_group, "Школа Пример: запуск курса", "private_group", 2000000202),
    (chat_saved, None, "saved_messages", ME[1]),
    (chat_bot, "Example Bot", "bot_chat", 1000000199),
    (chat_channel, "Новости Примера", "public_channel", 3000000301),
    (chat_public_group, "Публичный чат методистов", "public_supergroup", 3000000302),
    (chat_anna, "Анна", "personal_chat", ANNA[1]),
    (chat_landing_group, "🚀 Лендинг / Тильда", "private_group", 2000000203),
    (chat_sasha1, "Александр", "personal_chat", SASHA1[1]),
    (chat_sasha2, "Александр", "personal_chat", SASHA2[1]),
    (chat_igor, "Игорь", "personal_chat", IGOR[1]),
    (chat_mama, "Мама", "personal_chat", MAMA[1]),
]
LEFT_CHATS = [(lambda b, s: None, "Старый канал", "private_channel", 3000000303)]


def write_result(path: Path, data: dict, inject_x07: bool = False) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=1)
    if inject_x07:
        # Telegram Desktop writes control characters as \xNN, which is invalid JSON
        text = text.replace("\\u0007", "\\x07")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_full(root: Path, media: Media, s: dict) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    total = len(FULL_CHATS) + len(LEFT_CHATS)
    width = len(str(total - 1))
    lists = {"chats": [], "left_chats": []}
    n = 0
    for section, items in (("chats", FULL_CHATS), ("left_chats", LEFT_CHATS)):
        for fn, name, ctype, cid in items:
            n += 1
            prefix = f"chats/chat_{n:0{width}d}/"
            b = ChatBuilder(root, prefix, name, ctype, cid, media)
            fn(b, s)
            lists[section].append(b.chat)
    data = {
        "about": "Here is the data you requested. (fixture)",
        "personal_information": {"user_id": ME[1], "first_name": "Алексей", "last_name": "Пример",
                                 "phone_number": "+7 900 000 0000", "username": "@example_user"},
        "profile_pictures": [],
        "chats": {"about": "This page lists all chats from this export.", "list": lists["chats"]},
        "left_chats": {"about": "Below are the supergroups and channels from this export that you've left.",
                       "list": lists["left_chats"]},
    }
    write_result(root / "result.json", data, inject_x07=True)
    return root


def make_single(root: Path, media: Media, s: dict, fn, name, ctype, cid) -> Path:
    b = ChatBuilder(root, "", name, ctype, cid, media)
    fn(b, s)
    write_result(root / "result.json", b.chat)
    return root


def build_all(out: Path) -> dict:
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    media = Media(out.parent / (out.name + "-media-cache"))
    s = fake_secrets()
    paths = {
        "full": make_full(out / "full" / "DataExport_2026-10-11", media, s),
        "single": make_single(out / "single" / "ChatExport_2026-10-11", media, s, chat_daria, "Дарья",
                              "personal_chat", DARIA[1]),
    }
    make_single(out / "multi" / "ChatExport_2026-10-11", media, s, chat_viktor, "Виктор", "personal_chat", VIKTOR[1])
    make_single(out / "multi" / "ChatExport_2026-10-11 (1)", media, s, chat_team, "Команда Пример",
                "private_group", 2000000204)
    paths["multi"] = out / "multi"
    html_dir = out / "html_only" / "ChatExport_2026-10-11"
    html_dir.mkdir(parents=True)
    (html_dir / "messages.html").write_text("<html><body>Exported Data</body></html>", encoding="utf-8")
    paths["html_only"] = out / "html_only"
    paths["secrets"] = s
    paths["has_ffmpeg"] = bool(media.ffmpeg) and REEL.is_file()
    return paths


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1].startswith("-"):
        print(__doc__)
        sys.exit(2)
    p = build_all(Path(sys.argv[1]))
    for k, v in p.items():
        if k != "secrets":
            print(f"{k}: {v}")
