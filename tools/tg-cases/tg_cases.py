#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.14"   # Intel-Mac onnxruntime wheels stop at cp313; mlx has no cp315 wheels yet
# dependencies = [
#   "av>=12",
#   "numpy",
#   "mlx-whisper>=0.4.3; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "faster-whisper>=1.2.1; sys_platform != 'darwin' or platform_machine != 'arm64'",
# ]
# ///
"""tg_cases.py: finds paid freelance chats in a Telegram Desktop JSON export and builds
per-chat dossiers (with voice messages transcribed locally) for portfolio case drafts.

Everything runs on this computer. The script itself makes no network requests; only the
Whisper libraries download the speech model from Hugging Face once, on the first run.

    uv run tg_cases.py find  EXPORT              # report with candidate chats
    uv run tg_cases.py build EXPORT --chats ID,ID  # dossiers + CLAUDE.md

Plain `python3 tg_cases.py find ...` and `build --no-voice` work without uv (Python 3.9+).
Step-by-step guide in Russian: README.md next to this file.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import importlib.util
import json
import math
import os
import platform
import re
import sys
import time
import unicodedata
import webbrowser
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

DEFAULT_OUT = Path.home() / "tg-cases"   # not ~/Documents: it may sync to iCloud
WORKSPACE = "claude"                     # OUT/claude: the folder Claude opens (CLAUDE.md, dossiers, cases)
SPLIT_LIMIT = 120_000                    # characters per dossier file
SAMPLE_RATE = 16_000

KEEP_TYPES = {
    "personal_chat": "личный чат",
    "private_group": "группа",
    "private_supergroup": "группа",
}
SKIP_LABELS = {
    "saved_messages": "Избранное",
    "bot_chat": "чаты с ботами",
    "public_channel": "каналы",
    "private_channel": "каналы",
    "public_supergroup": "публичные группы",
    "replies": "служебные чаты",
    "verification_codes": "служебные чаты",
}
NDA_DEFAULT = {                          # spelling (lower case) -> name shown in warnings
    "tixu": "Tixu", "тиксу": "Tixu",
    "eduson": "Eduson", "эдюсон": "Eduson", "эдусон": "Eduson", "эдьюсон": "Eduson", "эдъюсон": "Eduson",
    "едюсон": "Eduson", "едусон": "Eduson",
}
NDA_MIN_HITS = 3

MEDIA_DIRS = {
    "chats", "voice_messages", "round_video_messages", "photos", "files", "video_files",
    "stickers", "animations", "contacts", "profile_pictures", "stories", "css", "js", "images", "lists",
}


class UserError(Exception):
    """Expected user mistake: printed as a Russian message, never as a traceback."""


# ----------------------------------------------------------------------------- small helpers

MONTHS_GEN = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
              "сентября", "октября", "ноября", "декабря")
WEEKDAYS = ("понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье")


def plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def fmt_day(d: dt.date) -> str:
    return f"{d.day} {MONTHS_GEN[d.month - 1]} {d.year}, {WEEKDAYS[d.weekday()]}"


def fmt_date(d) -> str:
    return d.strftime("%d.%m.%Y") if d else "?"


def fmt_period(first, last) -> str:
    if first and last and first.date() == last.date():
        return fmt_date(first)
    return f"{fmt_date(first)} – {fmt_date(last)}"


def fmt_clock(sec) -> str:
    """42 -> 0:42, 3725 -> 1:02:05"""
    sec = int(round(sec or 0))
    h, rest = divmod(sec, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fmt_minutes(sec) -> str:
    sec = float(sec or 0)
    if sec <= 0:
        return "0 мин"
    if sec < 60:
        return "меньше минуты"
    m = int(round(sec / 60))
    if m < 60:
        return f"{m} мин"
    h, m = divmod(m, 60)
    return f"{h} ч {m} мин" if m else f"{h} ч"


def fmt_call(sec) -> str:
    sec = int(sec or 0)
    return f"{sec} сек" if sec < 60 else f"{int(round(sec / 60))} мин"


def sh_quote(s: str) -> str:
    """Single-quote for zsh/bash: inside '...' nothing is special, ' becomes '\\''."""
    return "'" + str(s).replace("'", "'\\''") + "'"


def norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").casefold().replace("ё", "е")).strip()


_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh",
    "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "і": "i", "ї": "yi", "є": "ye", "ґ": "g",
}


def slugify(name: str, fallback: str) -> str:
    s = "".join(_TRANSLIT.get(ch, ch) for ch in (name or "").lower())
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40].rstrip("-")
    return s or fallback


def atomic_write_text(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def atomic_write_json(path: Path, data) -> None:
    atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=1))


def read_json_or(path: Path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (OSError, ValueError):
        # broken cache file: keep a copy for debugging and start over
        try:
            os.replace(path, path.with_name(path.name + ".broken"))
        except OSError:
            pass
        return default


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def is_apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


def ensure_private_dir(path: Path, owned: bool) -> None:
    """Create a folder readable only by this user. chmod only folders we own (not ~/Desktop)."""
    existed = path.exists()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if owned or not existed:
        try:
            os.chmod(path, 0o700)
        except OSError:
            pass


def out_warnings(out: Path) -> list:
    """Warn when client data would land in a synced folder or inside a git repo."""
    warns = []
    home = Path.home()
    synced = [home / "Documents", home / "Desktop", home / "Library" / "Mobile Documents",
              home / "Library" / "CloudStorage", home / "Dropbox", home / "Yandex.Disk.localized"]
    for s in synced:
        try:
            out.relative_to(s)
        except ValueError:
            continue
        warns.append(f"Папка {out} внутри {s}: она может синхронизироваться с облаком. "
                     f"Надёжнее оставить ~/tg-cases.")
        break
    for p in [out] + list(out.parents):
        if (p / ".git").exists():
            warns.append(f"Папка {out} внутри git-репозитория {p}. Не коммить её: там переписка с клиентами.")
            break
    return warns


# ----------------------------------------------------------------------------- export loading

ACCESS_HINT = (
    "macOS не даёт Терминалу открыть эту папку. Открой «Системные настройки», раздел «Конфиденциальность "
    "и безопасность», пункт «Файлы и папки», и разреши Терминалу доступ к папке «Загрузки». "
    "Или перенеси папку выгрузки в домашнюю папку и укажи новый путь."
)

HTML_EXPORT_HINT = (
    "Похоже, чаты выгружены в формате HTML (нашёл messages.html или export_results.html), "
    "а мне нужен JSON. Выгрузи ещё раз и в разделе формата выбери «Машиночитаемый JSON». "
    "Подробно: README.md, шаг 1."
)

_BAD_X = re.compile(r'(?<!\\)((?:\\\\)*)\\x([0-9A-Fa-f]{2})')


def load_json_lenient(path: Path):
    """Telegram writes rare control characters as \\xNN, which is invalid JSON: fix and retry."""
    try:
        raw = path.read_bytes()
    except PermissionError:
        raise UserError(ACCESS_HINT)
    except OSError as e:
        raise UserError(f"Не могу прочитать {path}: {e.strerror or e}")
    text = raw.decode("utf-8", errors="replace")
    if text.startswith("\ufeff"):
        text = text[1:]
    try:
        return json.loads(text, strict=False)
    except ValueError:
        pass
    fixed = _BAD_X.sub(lambda m: m.group(1) + "\\u00" + m.group(2), text)
    try:
        return json.loads(fixed, strict=False)
    except ValueError as e:
        line = getattr(e, "lineno", "?")
        raise UserError(
            f"Файл {path} не читается как JSON (ошибка около строки {line}). "
            "Скорее всего, выгрузка не закончилась или файл обрезан. Выгрузи чаты заново."
        )


class Chat:
    __slots__ = ("key", "id", "name", "type", "messages", "base", "source")

    def __init__(self, raw: dict, base: Path, source: Path):
        self.id = raw.get("id")
        self.type = raw.get("type") or "unknown"
        name = raw.get("name")
        self.name = name.strip() if isinstance(name, str) and name.strip() else (
            "Избранное" if self.type == "saved_messages" else
            "Удалённый аккаунт" if self.type == "personal_chat" else "Без названия")
        msgs = raw.get("messages")
        self.messages = [m for m in msgs if isinstance(m, dict)] if isinstance(msgs, list) else []
        self.base = base
        self.source = source
        self.key = str(self.id)

    @property
    def kept(self) -> bool:
        return self.type in KEEP_TYPES

    @property
    def type_label(self) -> str:
        return KEEP_TYPES.get(self.type) or SKIP_LABELS.get(self.type) or self.type


class Export:
    def __init__(self, path: Path):
        self.path = path            # what the user passed (resolved)
        self.files = []             # result.json files read
        self.chats = []             # all chats, including skipped types
        self.me_id = None           # from personal_information (full export only)
        self.me_name = None
        self.kinds = Counter()      # full / single
        self.duplicates = 0
        self.warnings = []          # broken exports skipped in a parent folder

    @property
    def kept(self) -> list:
        return [c for c in self.chats if c.kept]

    def by_key(self) -> dict:
        return {c.key: c for c in self.chats}


def resolve_input_path(raw: str) -> Path:
    s = (raw or "").strip()
    variants = [s]
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        variants.append(s[1:-1])
    variants.append(s.replace("\\ ", " "))
    for v in variants:
        p = Path(os.path.expanduser(v))
        if p.exists():
            return p.resolve()
    raise UserError(
        f"Не нашёл «{raw}». Проверь путь. Проще всего перетащить папку выгрузки "
        "из Finder прямо в окно Терминала: путь вставится сам."
    )


def locate_result_files(p: Path) -> list:
    if p.is_file():
        suffix = p.suffix.lower()
        if suffix == ".json":
            return [p]
        if suffix in (".html", ".htm"):
            raise UserError(HTML_EXPORT_HINT)
        raise UserError(f"{p} не похож на выгрузку Telegram. Укажи папку выгрузки или файл result.json.")
    try:
        os.listdir(p)
    except PermissionError:
        raise UserError(ACCESS_HINT)
    except OSError as e:
        raise UserError(f"Не могу открыть папку {p}: {e.strerror or e}")
    direct = p / "result.json"
    if direct.is_file():
        return [direct]
    found = []
    html_seen = [any((p / n).is_file() for n in ("messages.html", "export_results.html"))]

    def walk(d: Path, depth: int) -> None:
        try:
            entries = sorted(d.iterdir(), key=lambda e: e.name)
        except OSError:
            return
        for e in entries:
            if e.name.startswith(".") or e.name in MEDIA_DIRS:
                continue
            try:
                if not e.is_dir():
                    continue
            except OSError:
                continue
            r = e / "result.json"
            if r.is_file():
                found.append(r)
                continue
            if (e / "messages.html").is_file() or (e / "export_results.html").is_file():
                html_seen[0] = True
                continue
            if depth < 3:
                walk(e, depth + 1)

    walk(p, 1)
    if not found:
        if html_seen[0]:
            raise UserError(HTML_EXPORT_HINT)
        raise UserError(
            f"В папке {p} нет файла result.json. Укажи папку, которую создал Telegram "
            "(обычно DataExport_ГГГГ-ММ-ДД или ChatExport_ГГГГ-ММ-ДД в «Загрузки/Telegram Desktop»)."
        )
    return found


def media_on_disk(chat: Chat) -> int:
    """Voice and video notes of the chat that were exported (not placeholders, present on disk)."""
    n = 0
    for m in chat.messages:
        if media_kind(m) in ("voice", "round") and media_file(m, chat.base)[1]:
            n += 1
    return n


def load_export(raw_path: str) -> Export:
    path = resolve_input_path(raw_path)
    exp = Export(path)
    seen = {}       # (id, type) -> Chat
    used_keys = set()
    files = locate_result_files(path)
    for f in files:
        try:
            data = load_json_lenient(f)
            if not isinstance(data, dict):
                raise UserError(f"{f} не похож на выгрузку Telegram.")
        except UserError as e:
            if len(files) == 1:
                raise
            exp.warnings.append(f"пропускаю {f.parent.name}: {e}")      # one broken copy among several
            continue
        raw_chats = []
        if any(k in data for k in ("chats", "left_chats", "personal_information")):
            exp.kinds["full"] += 1
            pi = data.get("personal_information")
            if isinstance(pi, dict) and pi.get("user_id") is not None and exp.me_id is None:
                exp.me_id = f"user{pi['user_id']}"
                full = " ".join(x for x in (pi.get("first_name"), pi.get("last_name")) if isinstance(x, str) and x)
                exp.me_name = full or None
            for section in ("chats", "left_chats"):
                block = data.get(section)
                lst = block.get("list") if isinstance(block, dict) else block
                if isinstance(lst, list):
                    raw_chats.extend(c for c in lst if isinstance(c, dict))
        elif "messages" in data:
            exp.kinds["single"] += 1
            raw_chats.append(data)
        else:
            if len(files) == 1:
                raise UserError(f"{f} не похож на выгрузку чатов Telegram: в нём нет сообщений.")
            exp.warnings.append(f"пропускаю {f}: в нём нет сообщений.")
            continue
        exp.files.append(f)
        for rc in raw_chats:
            chat = Chat(rc, f.parent, f)
            if chat.id is None or not re.fullmatch(r"-?\d{1,20}", str(chat.id)):
                # Telegram ids are numbers; anything else must not reach the shell command
                chat.id = f"x{len(exp.chats) + 1}"
                chat.key = str(chat.id)
            ident = (str(chat.id), chat.type)
            if ident in seen:
                # the same chat exported twice: keep the longer copy; on a tie the one with more voice
                # notes on disk, then the later one (ChatExport_... (1) is the newer export)
                exp.duplicates += 1
                old = seen[ident]
                if (len(chat.messages), media_on_disk(chat)) >= (len(old.messages), media_on_disk(old)):
                    chat.key = old.key
                    exp.chats[exp.chats.index(old)] = chat
                    seen[ident] = chat
                continue
            key, n = chat.key, 2
            while key in used_keys:
                key = f"{chat.key}-{n}"
                n += 1
            chat.key = key
            used_keys.add(key)
            seen[ident] = chat
            exp.chats.append(chat)
    if not exp.chats:
        if exp.warnings and not exp.files:
            raise UserError("Ни одна выгрузка в папке не читается: " + "; ".join(exp.warnings))
        raise UserError("В выгрузке нет чатов. При экспорте отметь «Личные чаты» и «Частные группы».")
    return exp


# ----------------------------------------------------------------------------- message helpers

def flatten_text(value, links: bool = True) -> str:
    """`text` is "" or a string or a list of strings and entity objects."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        out = []
        for part in value:
            if isinstance(part, str):
                out.append(part)
            elif isinstance(part, dict):
                txt = part.get("text")
                txt = txt if isinstance(txt, str) else flatten_text(txt, links)
                href = part.get("href")
                if links and part.get("type") == "text_link" and isinstance(href, str) and href:
                    if href.strip() != txt.strip():
                        txt = f"{txt} ({href})" if txt.strip() else href
                out.append(txt)
        return "".join(out)
    if isinstance(value, dict):
        return flatten_text(value.get("text"), links)
    return str(value)


def _rich_strings(obj, out: list) -> None:
    # Telegram 7.x may write `rich_message` instead of `text`; its shape is not documented
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, list):
        for x in obj:
            _rich_strings(x, out)
    elif isinstance(obj, dict):
        for k in ("text", "texts", "items", "blocks", "content"):
            if k in obj:
                _rich_strings(obj[k], out)


def message_text(m: dict, links: bool = True) -> str:
    t = flatten_text(m.get("text"), links)
    if not t and isinstance(m.get("text_entities"), list):
        t = flatten_text(m["text_entities"], links)
    if not t and m.get("rich_message") is not None:
        parts = []
        _rich_strings(m["rich_message"], parts)
        t = " ".join(p for p in parts if p.strip())
    return t.replace("\r\n", "\n").replace("\r", "\n")


URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>«»\"'\[\]{}()]+", re.I)
_URL_TRAIL = ".,;:!?…"


def clean_url(u: str) -> str:
    return (u or "").strip().rstrip(_URL_TRAIL)


def message_links(m: dict) -> list:
    urls = []
    for src in (m.get("text_entities"), m.get("text")):
        if isinstance(src, list):
            for e in src:
                if isinstance(e, dict):
                    if e.get("type") == "link":
                        urls.append(e.get("text") or "")
                    elif e.get("type") == "text_link":
                        urls.append(e.get("href") or "")
    urls.extend(URL_RE.findall(message_text(m, links=False)))
    out, seen = [], set()
    for u in urls:
        u = clean_url(u)
        if not u or not re.match(r"(?:https?://|www\.)", u, re.I) or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def url_domain(u: str) -> str:
    try:
        host = urlsplit(u if "://" in u else "http://" + u).hostname or ""
    except ValueError:
        host = ""
    host = host.lower()
    return host[4:] if host.startswith("www.") else (host or "другое")


def msg_dt(m: dict):
    d = m.get("date")
    if isinstance(d, str) and d:
        try:
            return dt.datetime.fromisoformat(d[:19])
        except ValueError:
            pass
    u = m.get("date_unixtime")
    try:
        return dt.datetime.fromtimestamp(int(u))
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def sender_of(m: dict):
    """(from_id, name) for ordinary and service messages."""
    if m.get("type") == "service":
        fid, name = m.get("actor_id"), m.get("actor")
    else:
        fid, name = m.get("from_id"), m.get("from")
    fid = str(fid) if fid is not None else None
    name = name.strip() if isinstance(name, str) and name.strip() else None
    return fid, name


def is_placeholder(path_value) -> bool:
    # "(File not included. ...)", "(File exceeds maximum size. ...)", "(File unavailable, ...)"
    return not isinstance(path_value, str) or not path_value.strip() or path_value.strip().startswith("(")


def media_file(m: dict, base: Path):
    """(relative path or None, absolute Path or None if missing on disk)"""
    rel = m.get("file")
    if is_placeholder(rel):
        return None, None
    rel = rel.replace("\\", "/")
    p = base / rel
    try:
        return rel, (p if p.is_file() else None)
    except OSError:
        return rel, None


def media_kind(m: dict):
    mt = m.get("media_type")
    if mt == "voice_message":
        return "voice"
    if mt == "video_message":
        return "round"
    if mt in ("sticker", "animation", "video_file", "audio_file"):
        return mt
    if "photo" in m:
        return "photo"
    if "file" in m or "file_name" in m:
        return "document"
    for key, kind in (("contact_information", "contact"), ("location_information", "location"),
                      ("place_name", "location"), ("poll", "poll"), ("game_title", "game"),
                      ("invoice_information", "invoice"), ("todo_list", "todo"),
                      ("giveaway_information", "giveaway"), ("giveaway_results", "giveaway")):
        if key in m:
            return kind
    return None


def file_display_name(m: dict) -> str:
    n = m.get("file_name")
    if isinstance(n, str) and n.strip():
        return n.strip()
    f = m.get("file")
    if isinstance(f, str) and not is_placeholder(f):
        return f.replace("\\", "/").rsplit("/", 1)[-1]
    return "без имени"


# ----------------------------------------------------------------------------- who is "me"

def detect_me(exp: Export, me_override=None):
    """Returns (set of from_ids, display name, how). Russian `how` is printed to the user."""
    names = {}           # from_id -> Counter of names
    msgs = Counter()
    chats_seen = Counter()
    saved_ids = set()
    for chat in exp.chats:
        if chat.type == "saved_messages" and chat.id is not None:
            saved_ids.add(f"user{chat.id}")
        peer = f"user{chat.id}" if chat.type in ("personal_chat", "bot_chat") else None
        here = set()
        for m in chat.messages:
            fid, name = sender_of(m)
            if not fid:
                continue
            if name:
                names.setdefault(fid, Counter())[name] += 1
            if fid == peer or not fid.startswith("user"):
                continue
            msgs[fid] += 1
            here.add(fid)
        for fid in here:
            chats_seen[fid] += 1

    def best_name(fid, fallback=None):
        c = names.get(fid)
        return c.most_common(1)[0][0] if c else (fallback or fid)

    if me_override:
        want = norm_name(me_override)
        exact = [f for f, c in names.items() if any(norm_name(n) == want for n in c)]
        loose = [f for f, c in names.items() if any(want in norm_name(n) for n in c)]
        pick = exact or loose
        if not pick:
            top = [best_name(f) for f, _ in msgs.most_common(12) if names.get(f)][:8]
            raise UserError(
                f"Не нашёл отправителя с именем «{me_override}». Самые частые имена в выгрузке: "
                + ", ".join(f"«{n}»" for n in top) + ". Укажи имя так, как оно записано в Telegram."
            )
        pick.sort(key=lambda f: (chats_seen[f], msgs[f]), reverse=True)
        return {pick[0]}, best_name(pick[0]), "по --me"
    if exp.me_id:
        return {exp.me_id}, exp.me_name or best_name(exp.me_id), "по данным аккаунта"
    if saved_ids:
        fid = sorted(saved_ids)[0]
        return {fid}, best_name(fid, "Я"), "по чату «Избранное»"
    if msgs:
        fid = max(msgs, key=lambda f: (chats_seen[f], msgs[f]))
        return {fid}, best_name(fid), "угадал по переписке"
    return set(), "Я", "не удалось определить"


# ----------------------------------------------------------------------------- redaction

URL_PLACE = "\ue000{}\ue001"
_PLACE_RE = re.compile("\ue000(\\d+)\ue001")

# File names glue numbers with "_" (Паспорт_4510_123456.pdf), so the number rules look only at
# letters and digits around them, not at \w (which includes "_").
_NB = r"(?<![^\W_])"            # not right after a letter or digit

_PW_LABEL = r"логин\s*/\s*пароль|login\s*/\s*password|пароль|парол[яюе]|password|логин|login|доступ(?:ы|а)?"
_PW_VALUE = r"[^\s\[\ue000]\S{0,80}?(?<!:)(?=[,;.)]*(?:\s|$))"
_PW_SEP = re.compile(
    # label, then up to 40 characters of qualifier on the same line ("от админки GetCourse"),
    # then ":" "=" or " - " and the value; "логин/пароль: a / b" also takes the second value
    r"(?P<label>(?:\b(?:" + _PW_LABEL + r")\b[^\n:=.!?;]{0,40}?(?<![\d\s])|\b(?:passwd|pwd|pass)\b)"
    r"\s*(?P<sep>[:=]|\s[-–—])\s*)(?P<val>" + _PW_VALUE + r")"
    r"(?:(?P<mid>\s*/\s*)(?P<val2>" + _PW_VALUE + r"))?",
    re.I)
_PW_BARE = re.compile(
    # "пароль от тильды Kx9#mPq2", "пароль поменял на Qwerty2024": up to 3 words, then a value with
    # a digit or a symbol (not a short number, a time or a date, not a "label: value" pair masked above)
    r"(?P<label>\b(?:пароль|password|pass)\b(?:\s+[^\s:=\[]{1,30}){0,3}?\s+)"
    r"(?P<val>(?=\S*[\d!@#$%^&*_+=?~])(?!(?:\d{1,5}|[\d:./\-]*[:./\-][\d:./\-]*)[,;.)]*(?:\s|$))"
    r"[^\s\[\ue000]\S{3,80}?)"
    r"(?<!:)(?=[,;.)]*(?:\s|$))(?!\s*[:=])", re.I)
_KEY_LABEL = re.compile(
    # "ключ API: 7f3k29dk3m", "токен: Ab12...", "secret=...", "ключ тильды a1b2...", "Код доступа: 123456"
    r"(?P<label>\b(?P<word>api[ _\-]?key|apikey|api[ _\-]?ключ|ключ(?:и|а)?|токен\w*|token|secret|секрет\w*"
    r"|код\s+доступа|пин-?код|passcode|access\s+code)\b[^\n:=.!?;]{0,30}?(?<![\d\s])(?:\s*[:=]\s*|\s+))"
    r"(?P<val>[A-Za-z0-9_\-+/=.]{4,200}?)(?=[,;.)]*(?:\s|$))", re.I)

_KEY_RES = [
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"\bxox[abposr]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?<!\d)\d{6,12}:[A-Za-z0-9_\-]{35}(?![A-Za-z0-9_\-])"),     # Telegram bot token
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),  # JWT
    re.compile(r"\b(?:pk|rk|sk)_(?:live|test)_[A-Za-z0-9]{16,}"),
    re.compile(r"\bhf_[A-Za-z0-9]{30,}"),
    re.compile(r"\bya29\.[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\by0_[A-Za-z0-9_\-]{30,}"),
]
_BEARER = re.compile(r"(\bBearer\s+)[A-Za-z0-9\-._~+/]{16,}=*", re.I)
_EMAIL = re.compile(r"(?<![\w.+\-])[\w.+\-]+(?:@|\s@\s|\s?\[at\]\s?|\s?\(at\)\s?)"
                    r"(?:[^\W_](?:[^\W_]|-)*\.)+[^\W\d_]{2,}(?![^\W_]|-)", re.I)
_IBAN = re.compile(_NB + r"[A-Z]{2}\d{2}(?:[ _]?[A-Z0-9]{4}){2,7}(?:[ _]?[A-Z0-9]{1,4})?(?![^\W_])", re.I)
_SNILS = re.compile(
    r"(?<!\d)\d{3}-\d{3}-\d{3}[ \-_]\d{2}(?!\d)"
    r"|(?P<label>снилс\w*[\s_:№]*)\d{3}[ \-_]?\d{3}[ \-_]?\d{3}[ \-_]?\d{2}(?!\d)", re.I)
_PASSPORT = re.compile(
    r"(?P<l1>(?:паспорт\w*|пасп\.)[^\d\n]{0,40}?)\d{2}[ _]?\d{2}[ _\-]?(?:№ ?)?\d{6}(?!\d)"
    r"|(?P<l2>серия\s*:?\s*)\d{2}[ _]?\d{2}[,\s]*(?:номер|№)\s*:?\s*\d{6}(?!\d)", re.I)
_REQUISITES = re.compile(_NB + r"(ИНН|КПП|БИК|ОГРНИП|ОГРН)([\s_:№]*)\d{9,15}(?!\d)", re.I)
# a run of digits with single separators: cards, bank accounts and money all look like this
_DIGIT_RUN = re.compile(r"(?<!\d)\d+(?:(?:[ \-.]{1,2}|_)\d+)*")
_PHONE_RU = re.compile(r"(?<![^\W_]|\+)(?:\+7|8|7)[ \-.]?\(?\d{3,4}\)?[ \-.]?\d{2,3}[ \-.]?\d{2}[ \-.]?\d{2}(?!\d)")
_PHONE_PAREN = re.compile(r"(?<![^\W_]|[+(])\(\d{3}\)[ \-]?\d{3}[ \-]?\d{2}[ \-]?\d{2}(?!\d)")
_PHONE_MOBILE = re.compile(_NB + r"9\d{2}([ \-.]?)\d{3}\1\d{2}\1\d{2}(?!\d)")       # 912-345-67-89
_PHONE_INTL = re.compile(r"(?<![^\W_]|\+)\+\d{1,3}[ \-.]?\(?\d{1,4}\)?(?:[ \-.]?\d{2,4}){2,5}(?!\d)")
_CURRENCY_AFTER = re.compile(r"\s*(?:₽|руб|р\.|р\b|rub|\$|usd|долл|€|eur|евро|тыс|млн)", re.I)
_LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9_\-+/=])[A-Za-z0-9_\-+/=]{32,}(?![A-Za-z0-9_\-+/=])")
_URL_SECRET_PARAM = re.compile(
    r"([?&#](?:access_?)?(?:token|key|api_?key|secret|password|pass|pwd|sig|signature|auth)=)[^&\s]+", re.I)
_URL_RULES = [
    (re.compile(r"(?i)((?:wa\.me|t\.me|telegram\.me)/\+?)\d{7,15}"), "[телефон]"),
    (re.compile(r"(?i)([?&#](?:phone|tel|mobile|msisdn)=)[+\d\-.()%]{7,30}"), "[телефон]"),
    (re.compile(r"(?i)([?&#](?:card|card_?number|pan)=)[\d\-%]{12,30}"), "[карта]"),
    (re.compile(r"(?i)(hooks\.slack\.com/services/)[^\s?#]+"), "[ключ]"),
    (re.compile(r"(?i)(discord(?:app)?\.com/api/webhooks/)[^\s?#]+"), "[ключ]"),
    (re.compile(r"(://)[^/\s:@]+:[^/\s@]+@"), "[логин]:[пароль]@"),
]


def _luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def _iban_ok(s: str) -> bool:
    s = re.sub(r"[ _]", "", s).upper()
    if not 15 <= len(s) <= 34:
        return False
    moved = s[4:] + s[:4]
    try:
        num = "".join(str(int(ch, 36)) for ch in moved)
        return int(num) % 97 == 1
    except ValueError:
        return False


def _entropy(s: str) -> float:
    c = Counter(s)
    n = len(s)
    return -sum(v / n * math.log2(v / n) for v in c.values())


def _looks_random(tok: str) -> bool:
    has_digit, has_letter = re.search(r"\d", tok), re.search(r"[A-Za-z]", tok)
    if re.fullmatch(r"[0-9a-fA-F]{32,}", tok) and has_digit and has_letter:
        return True                      # hashes and hex keys (not "AAAA...")
    if not (has_digit and has_letter):
        return False
    parts = re.split(r"[_\-./+=]", tok)
    wordy = sum(len(p) for p in parts if re.fullmatch(r"[A-Z]?[a-z]{2,}|[A-Z]{2,}|\d{1,4}", p))
    if wordy >= 0.5 * len(tok):
        return False                     # file_name_like_this_2024
    return _entropy(tok) >= 3.8


def _secret_like(v: str) -> bool:
    return bool(re.search(r"[\d!@#$%^&*_+=?~]", v) or (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v)))


def _plain_word(v: str) -> bool:
    """A Russian word, not a password: «пароль: пришлю отдельно», «логин: тот же»."""
    return bool(re.fullmatch(r"[А-Яа-яЁё\-]+", v))


def _redact_url(u: str) -> str:
    u = _URL_SECRET_PARAM.sub(lambda m: m.group(1) + "[ключ]", u)
    for rx, token in _URL_RULES:
        u = rx.sub(lambda m, token=token: m.group(1) + token, u)
    for rx in _KEY_RES:
        u = rx.sub("[ключ]", u)
    return _EMAIL.sub("[email]", u)


def _digit_run(m) -> str:
    """Bank accounts (20 digits in any grouping) and Luhn-valid cards inside a run of digits.
    Money keeps its look: groups of three after the first group (1 500 000) are never a card."""
    s = m.group(0)
    seps = re.split(r"\d+", s)[1:-1]
    groups = re.findall(r"\d+", s)
    if sum(map(len, groups)) < 13:
        return s
    if len(groups) > 2 and len(groups[0]) <= 3 and all(len(g) == 3 for g in groups[1:]):
        return s                                   # 1 000 000 000 000: money
    out, i = [], 0
    while i < len(groups):
        hit, digits = None, ""
        for j in range(i + 1, len(groups) + 1):        # windows of whole groups, at most 20 digits
            digits += groups[j - 1]
            if len(digits) > 20:
                break
            if len(digits) == 20 and (i == 0 or j == len(groups)):
                hit = (j, "[счёт]")                    # Russian bank account: 40817 810 0 0000 0001234
            elif 13 <= len(digits) <= 19 and _luhn_ok(digits) and (
                    j - i == 1 or all(len(g) >= 4 for g in groups[i:j - 1]) and len(groups[j - 1]) >= 3):
                hit = (j, "[карта]")                   # 4-4-4-4, 4-6-5 or one block of digits
        if hit:
            out.append(hit[1])
            i = hit[0]
        else:
            out.append(groups[i])
            i += 1
        if i < len(groups):
            out.append(seps[i - 1])
    return "".join(out)


def redact(text: str, filename: bool = False) -> str:
    """Mask contacts, card and bank numbers, documents, passwords and keys. Money, dates,
    times, years, short order numbers and ordinary links stay as they are.
    filename=True: a file name; "_" counts as a space, the extension is kept."""
    if not text:
        return text
    if filename:
        base, ext = os.path.splitext(text)
        if not ext or len(ext) > 6 or " " in ext:
            base, ext = text, ""
        spaced = base.replace("_", " ")
        masked = redact(spaced)
        return text if masked == spaced else masked + ext
    urls = []

    def keep_url(m):
        urls.append(m.group(0))
        return URL_PLACE.format(len(urls) - 1)

    t = URL_RE.sub(keep_url, text)

    def pw(m):
        label, val, val2 = m.group("label"), m.group("val"), m.group("val2")
        if m.group("sep") not in (":", "=") and not _secret_like(val):
            return m.group(0)                        # "логин - это почта": a sentence, not a value
        if _plain_word(val):
            return m.group(0)                        # "пароль: пришлю отдельно"
        words = [w.lower() for w in re.findall(r"(?i)логин|login|парол|pass|pwd|доступ", label)]
        both = any(w in ("логин", "login") for w in words) and any(w in ("парол", "pass", "pwd") for w in words)
        if words[-1] == "доступ" and not val2:
            return m.group(0)                        # "доступ: 24/7"; only "доступ: логин / пароль"
        if val2 and (both or words[-1] == "доступ"):
            return label + "[логин]" + m.group("mid") + "[пароль]"
        out = label + ("[логин]" if words[-1] in ("логин", "login") else "[пароль]")
        if val2:
            secret2 = _secret_like(val2) and not _plain_word(val2)
            out += m.group("mid") + ("[пароль]" if secret2 else val2)
        return out

    t = _PW_SEP.sub(pw, t)

    t = _PW_BARE.sub(lambda m: m.group("label") + "[пароль]", t)

    def key_label(m):
        v, word = m.group("val"), m.group("word").lower()
        if re.match(r"код|пин|passcode|access", word):
            ok = re.fullmatch(r"\d{4,10}", v) or (len(v) >= 6 and _secret_like(v))
            return m.group("label") + "[пароль]" if ok else m.group(0)
        ok = len(v) >= 8 and re.search(r"\d", v) and re.search(r"[A-Za-z]", v)
        return m.group("label") + "[ключ]" if ok else m.group(0)

    t = _KEY_LABEL.sub(key_label, t)
    for rx in _KEY_RES:
        t = rx.sub("[ключ]", t)
    t = _BEARER.sub(lambda m: m.group(1) + "[ключ]", t)
    t = _EMAIL.sub("[email]", t)

    def iban(m):
        s = m.group(0)
        for end in range(len(s), 14, -1):            # the longest prefix that passes the checksum
            if s[end - 1] not in " _" and _iban_ok(s[:end]):
                return "[счёт]" + s[end:]
        return s

    t = _IBAN.sub(iban, t)
    t = _SNILS.sub(lambda m: (m.group("label") or "") + "[СНИЛС]", t)
    t = _PASSPORT.sub(lambda m: (m.group("l1") or m.group("l2") or "") + "[паспорт]", t)
    t = _REQUISITES.sub(lambda m: m.group(1) + m.group(2) + "[реквизиты]", t)
    t = _DIGIT_RUN.sub(_digit_run, t)

    def phone(m):
        digits = re.sub(r"\D", "", m.group(0))
        return "[телефон]" if len(digits) == 11 or m.group(0).startswith("(") else m.group(0)

    t = _PHONE_RU.sub(phone, t)
    t = _PHONE_PAREN.sub(phone, t)
    t = _PHONE_MOBILE.sub("[телефон]", t)

    def phone_intl(m):
        s = m.group(0)
        digits = re.sub(r"\D", "", s)
        groups = re.findall(r"\d+", s)
        if not 8 <= len(digits) <= 15:
            return s
        if len(groups) >= 3 and all(len(g) == 3 for g in groups[1:]) and (
                len(digits) <= 9 or _CURRENCY_AFTER.match(t, m.end())):
            return s                                 # "+12 500 000 подписчиков": a number, not a phone
        return "[телефон]"

    t = _PHONE_INTL.sub(phone_intl, t)
    t = _LONG_TOKEN.sub(lambda m: "[ключ]" if _looks_random(m.group(0)) else m.group(0), t)
    if urls:
        t = _PLACE_RE.sub(lambda m: _redact_url(urls[int(m.group(1))]), t)
    return t


def keep_text(text: str, filename: bool = False) -> str:
    """--no-redact: the same call shape as redact()."""
    return text


# ----------------------------------------------------------------------------- scoring

# Keyword table: (label, category, weight, regex). Regexes use only non-capturing groups.
KEYWORDS = [
    ("ТЗ", "задача", 3.0, r"\bтз\b|\bтзшк\w*|\bтехзадани\w*|\bтехническ\w*\s+задани\w*|\bspecs?\b"),
    ("бриф", "задача", 2.5, r"\bбриф\w*|\bbriefs?\b|\bbriefing\b"),
    ("заказ", "задача", 2.0, r"\bзаказ(?:а|у|ом|е|ы|ов)?\b|\bзаказчик\w*|\bфриланс\w*|\bfreelanc\w*|\bclient\w*|\bклиент\w*"),
    ("счёт", "деньги", 2.5, r"(?<!за )\bсч[её]т(?:а|у|ом|е|ы|ов)?\b|\bинвойс\w*|\binvoice\w*"),
    ("оплата", "деньги", 3.0, r"\b(?:пред)?опла[тч]\w*|\bаванс\w*|\bгонорар\w*|\bpayment\w*|\bpaid\b|\bprepay\w*|\bpay\b"),
    ("перевёл", "деньги", 1.5, r"\bперев[её]л(?:а|и)?\b|\bпереведу\b|\bскинул(?:а)?\s+(?:деньги|оплату|аванс)"),
    ("бюджет", "деньги", 2.5, r"\bбюджет\w*|\bстоимост\w*|\bрасценк\w*|\bпрайс\w*|\bсколько\s+стоит\w*|\bbudget\w*|\bprice\w*|\bquote\b"),
    ("реквизиты", "документы", 2.5, r"\bреквизит\w*"),
    ("договор", "документы", 3.0, r"\bдоговор(?:а|у|ом|е|ы|ов|ам|ами|ах)?\b|\bдоговорн\w*|\bконтракт\w*|\bcontract\w*|\bnda\b|\bоферт\w*"),
    ("акт", "документы", 2.0, r"\bакт(?:а|ы|у|ом|ов)?\b"),
    ("самозанятый", "документы", 3.0, r"\bсамозанят\w*|\bип\b|\bинн\b"),
    ("чек", "документы", 1.5, r"\bчек(?:а|и|у|ом|ов)?\b(?!\s*-?\s*лист)|\breceipt\w*"),
    ("дедлайн", "сроки", 2.0, r"\bдедлайн\w*|\bdeadline\w*"),
    ("сроки", "сроки", 1.5, r"\bсрок(?:а|и|у|ом|ов|ам|ах)?\b"),
    ("правки", "работа", 2.0, r"\bправк\w*|\bдоработ\w*|\brevision\w*|\bfeedback\b|\bфидб[еэ]к\w*"),
    ("макет", "работа", 2.0, r"\bмакет\w*|\bпрототип\w*|\bmock-?ups?\b|\bprototyp\w*|\bwireframe\w*"),
    ("согласовать", "работа", 1.5, r"\bсогласов\w*|\bутвердил\w*|\bутвержд\w*"),
    ("курс", "продукт", 1.5, r"(?<![вВ] )\bкурс(?:а|у|ом|е|ы|ов|ам|ами|ах)?\b|(?<!of )\bcourses?\b"),
    ("урок", "продукт", 1.5, r"\bурок\w*|\blessons?\b"),
    ("модуль", "продукт", 1.5, r"\bмодул\w*|\bmodules?\b"),
    ("сценарий", "продукт", 1.5, r"\bсценари\w*|\bscripts?\b"),
    ("методичка", "продукт", 2.0, r"\bметодичк\w*|\bметодолог\w*|\bметодическ\w*"),
    ("лендинг", "продукт", 1.5, r"\bл[еэ]ндинг\w*|\blanding\w*"),
    ("сайт", "продукт", 1.0, r"\bсайт\w*|\bwebsites?\b"),
    ("бот", "продукт", 1.0, r"\bбот(?:а|у|ом|е|ы|ов|ами)?\b|\bchat-?bots?\b"),
    ("игра", "продукт", 1.0, r"\bигр(?:а|ы|у|ой|е|ам|ами|ах)?\b|\bgames?\b"),
    ("приложение", "продукт", 1.0, r"\bприложени\w*|\bapps?\b"),
    ("презентация", "продукт", 1.0, r"\bпрезентаци\w*|\bpresentations?\b|\bслайд\w*"),
    ("вебинар", "продукт", 1.5, r"\bвебинар\w*|\bwebinars?\b"),
    ("гайд", "продукт", 1.0, r"\bгайд\w*|\bguides?\b"),
    ("тренажёр", "продукт", 2.0, r"\bтренаж[её]р(?:а|у|ом|е|ы|ов|ам|ами|ах)?\b|\bсимулятор\w*|\bsimulators?\b"),
    ("LMS", "инструменты", 2.0, r"\bgetcourse\b|\bгеткурс\w*|\blms\b|\bscorm\b|\bispring\b|\barticulate\b|\bmoodle\b"),
    ("Tilda", "инструменты", 1.5, r"\btilda\b|\bтильд\w*"),
    ("Notion", "инструменты", 1.0, r"\bnotion\b|\bноушн\w*"),
    ("Figma", "инструменты", 1.5, r"\bfigma\b|\bфигм\w*"),
    ("Miro", "инструменты", 1.0, r"\bmiro\b|\bмиро\b"),
    ("нейросети", "инструменты", 1.0, r"\bнейросет\w*|\bнейронк\w*|\bchatgpt\b|\bчатгпт\w*|\bgpt\b|\bпромпт\w*|\bprompts?\b|\bclaude\b|\bmidjourney\b"),
]
STRONG_CATEGORIES = {"задача", "деньги", "документы", "сроки", "работа"}
# every alternative starts at a word boundary: the outer \b skips mid-word positions (3-4x faster)
KW_RE = re.compile(r"\b(?=\w)(?:" + "|".join(f"(?P<k{i}>{k[3]})" for i, k in enumerate(KEYWORDS)) + ")", re.I)
_HAS_DIGIT = re.compile(r"\d")
KW_SINGLE = [re.compile(k[3], re.I) for k in KEYWORDS]

_NUM = r"\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d+)?"
_CUR = r"₽|руб\w*|р\.|р(?![\w])|rub(?![\w])|usdt(?![\w])|usd(?![\w])|долл\w*|бакс\w*|€|eur(?![\w])|евро(?![\w])|\$"
MONEY_RE = re.compile(
    r"(?<![\w.,])(?:"
    r"(?:[$€£]|usdt\s?|usd\s?|eur\s?|rub\s?)(?:" + _NUM + r")(?:\s?(?:k|к|тыс\.?|млн\.?)(?![\w]))?"
    r"|(?:" + _NUM + r")(?:k|к)(?![\w])"
    r"|(?:" + _NUM + r")\s?(?:тыс(?:\.|(?![\w]))|т\.\s?р\.?|тр(?![\w]))(?:\s?(?:" + _CUR + r"))?"
    r"|(?:" + _NUM + r")\s?(?:тысяч\w*|млн\.?|миллион\w*)\s?(?:" + _CUR + r")"
    r"|(?:" + _NUM + r")\s?(?:" + _CUR + r")"
    r")", re.I)
MONEY_CTX_RE = re.compile(
    r"(?:\bстоимост\w*|\bбюджет\w*|\bцен[аеуы]\b|\bоплат\w*|\bгонорар\w*|\bаванс\w*|\bитого\b|\bсумм[аеуы]\b"
    r"|\bprice\b|\bbudget\b|\bfee\b)[^\d\n]{0,20}?(?<![\d.,])(\d{1,3}(?:[ \u00a0]\d{3})+|\d{3,7})(?![\d.,:/%])", re.I)


def money_spans(text: str) -> list:
    """[(start, end, amount_text)] without overlaps."""
    spans = [(m.start(), m.end(), m.group(0).strip()) for m in MONEY_RE.finditer(text)]
    for m in MONEY_CTX_RE.finditer(text):
        num = m.group(1)
        if re.fullmatch(r"(?:19[5-9]\d|20[0-4]\d)", num):
            continue                     # a year, not an amount
        s, e = m.start(1), m.end(1)
        if not any(a < e and s < b for a, b, _ in spans):
            spans.append((s, e, num))
    spans.sort()
    return spans


def make_nda_re(extra=None):
    """Matches NDA words with any ending (Tixu, тиксушники, в Эдюсоне); group 1 is the word itself."""
    words = list(NDA_DEFAULT) + [w.strip().lower() for w in (extra or []) if w and w.strip()]
    words = sorted(set(words), key=len, reverse=True)
    return re.compile(r"(?<![^\W_])(" + "|".join(re.escape(w) for w in words) + r")\w*", re.I)


def nda_label(word: str) -> str:
    w = (word or "").lower()
    return NDA_DEFAULT.get(w) or w[:1].upper() + w[1:]


def parse_nda_words(raw) -> list:
    return [w.strip() for w in re.split(r"[,;]", raw or "") if w.strip()]


def chat_language(texts_cyr: int, texts_lat: int):
    """Whisper language hint: "ru" for a clearly Russian chat, else None (Whisper detects it).
    English is never forced: pasted code, links and tool names make Russian chats look Latin."""
    total = texts_cyr + texts_lat
    if total < 200:
        return None
    return "ru" if texts_cyr / total >= 0.6 else None


# "вы" and "ты" in a personal chat: pronouns and the most common verbs of a request
_FORMAL_RE = re.compile(r"\b(?:вы|вас|вам|вами|ваш\w*|здравствуйте|пришлите|скиньте|подскажите|скажите|посмотрите"
                        r"|напишите|отправьте|сделайте|можете|сможете|хотите|знаете|будете)\b", re.I)
_INFORMAL_RE = re.compile(r"\b(?:ты|тебя|тебе|тобой|тво[йяеёи]\w*|скинь|пришли|подскажи|глянь|посмотри|напиши"
                          r"|\w{2,}(?:ешь|ёшь|ишь))\b", re.I)
_LETTERS_CYR = re.compile(r"[А-Яа-яЁё]")
_LETTERS_LAT = re.compile(r"[A-Za-z]")
WINDOW = 300            # messages: a project is a dense stretch of the chat, see score_chat
OPENING = 10            # messages at the start of the chat that may hold the original request
LONG_CALL = 300         # seconds
DENSITY_FULL = 0.12     # keyword messages per message at which a window keeps its full score


def analyze_chat(chat: Chat, me_ids: set, since=None, nda_re=None) -> dict:
    """One pass over the chat: counters for the report, the dossier header and the score."""
    nda_re = nda_re or make_nda_re()
    st = {
        "key": chat.key, "id": chat.id, "name": chat.name, "type": chat.type, "type_label": chat.type_label,
        "first": None, "last": None, "messages": 0, "mine": 0, "days": set(),
        "voices": 0, "voice_sec": 0, "rounds": 0, "round_sec": 0,
        "calls": 0, "call_sec": 0, "long_calls": 0, "missed_calls": 0,
        "files": [], "kw": Counter(), "kw_hits": [], "money": [], "nda_hits": 0, "nda_words": Counter(),
        "senders": Counter(), "first_msgs": [], "cyr": 0, "lat": 0,
        "formal": 0, "informal": 0, "opening": False, "money_senders": set(),
    }
    marks = []          # (message number, keyword labels, money mentions, is a document) for the window
    seen_labels = set()
    for idx, m in enumerate(chat.messages):
        mtype = m.get("type", "message")
        if mtype == "unsupported":
            continue
        d = msg_dt(m)
        before_since = bool(since and d and d < since)
        if mtype == "service":
            if before_since:
                continue
            act = m.get("action")
            dur = _int(m.get("duration")) if act == "group_call" else _int(m.get("duration_seconds"))
            if act in ("phone_call", "conference_call", "group_call"):
                if dur > 0:
                    st["calls"] += 1
                    st["call_sec"] += dur
                    st["long_calls"] += dur >= LONG_CALL
                elif act != "group_call":
                    st["missed_calls"] += 1
            continue
        text = message_text(m, links=False)
        if len(text) > 20000:
            text = text[:20000]
        # NDA over the whole chat, --since or not: a Tixu work chat must never lose its flag
        for w in nda_re.findall(text) + [w for h in message_hrefs(m) for w in nda_re.findall(h)]:
            st["nda_hits"] += 1
            st["nda_words"][nda_label(w)] += 1
        if before_since:
            continue
        st["messages"] += 1
        if d:
            st["first"] = d if st["first"] is None or d < st["first"] else st["first"]
            st["last"] = d if st["last"] is None or d > st["last"] else st["last"]
            st["days"].add(d.date())
        fid, name = sender_of(m)
        mine = fid in me_ids
        who = "Я" if mine else (name or "Удалённый аккаунт")
        st["mine"] += mine
        st["senders"][who] += 1
        kind = media_kind(m)
        if kind == "voice":
            st["voices"] += 1
            st["voice_sec"] += _int(m.get("duration_seconds"))
        elif kind == "round":
            st["rounds"] += 1
            st["round_sec"] += _int(m.get("duration_seconds"))
        elif kind == "document":
            st["files"].append((idx, d, "Я" if mine else (name or "?"), file_display_name(m)))
        if len(st["first_msgs"]) < 3 and (text.strip() or kind):
            st["first_msgs"].append(idx)
        if not text.strip():
            if kind == "document":
                marks.append((st["messages"], (), 0, True))
            continue
        labels_here = set()
        for mm in KW_RE.finditer(text):
            i = int(mm.lastgroup[1:])
            labels_here.add(i)
            if i not in seen_labels or len(st["kw_hits"]) < 40:
                st["kw_hits"].append((idx, i))
                seen_labels.add(i)
        for i in labels_here:
            st["kw"][KEYWORDS[i][0]] += 1
        spans = money_spans(text) if _HAS_DIGIT.search(text) else []
        for s, e, amount in spans[:3]:
            st["money"].append((idx, d, amount))
        if spans or any(KEYWORDS[i][1] == "деньги" for i in labels_here):
            st["money_senders"].add(who)
        if labels_here or spans or kind == "document":
            marks.append((st["messages"], tuple(labels_here), min(len(spans), 3), kind == "document"))
            if st["messages"] <= OPENING and (spans or any(KEYWORDS[i][1] in STRONG_CATEGORIES
                                                            for i in labels_here)):
                st["opening"] = True
        if chat.type == "personal_chat":
            st["formal"] += bool(_FORMAL_RE.search(text))
            st["informal"] += bool(_INFORMAL_RE.search(text))
        if st["cyr"] + st["lat"] < 20000:
            words = URL_RE.sub(" ", text)
            st["cyr"] += len(_LETTERS_CYR.findall(words))
            st["lat"] += len(_LETTERS_LAT.findall(words))
    st["nda_name_words"] = sorted({nda_label(w) for w in nda_re.findall(chat.name or "")})
    st["nda_in_name"] = bool(st["nda_name_words"])
    st["nda"] = st["nda_in_name"] or st["nda_hits"] >= NDA_MIN_HITS
    st["lang"] = chat_language(st["cyr"], st["lat"])
    st["window"] = best_window(marks, st["messages"])
    st["score"], st["signal"] = score_chat(st)
    voice_min = (st["voice_sec"] + st["round_sec"]) / 60
    st["voice_signal"] = not st["signal"] and (voice_min >= 10 or st["long_calls"] >= 2)
    st["active_days"] = len(st["days"])
    st["peer"] = peer_name(chat, st)
    st["title"] = chat_title(chat, st["peer"])
    return st


def message_hrefs(m: dict) -> list:
    """Hidden links of text_link entities (the visible text may differ from the address)."""
    out = []
    for src in (m.get("text"), m.get("text_entities")):
        if isinstance(src, list):
            for e in src:
                if isinstance(e, dict) and e.get("type") == "text_link" and isinstance(e.get("href"), str):
                    out.append(e["href"])
            if out:
                break
    return out


def peer_name(chat: Chat, st: dict):
    """Full name of the other person in a personal chat (`name` of the chat is the first name only)."""
    if chat.type != "personal_chat":
        return None
    for who, _n in st["senders"].most_common():
        if who not in ("Я", "Удалённый аккаунт"):
            return who
    return None


def nda_names(st: dict) -> list:
    """NDA words found in the chat: from its name first, then by the number of mentions."""
    out = list(st.get("nda_name_words") or [])
    out += [w for w, _n in st["nda_words"].most_common() if w not in out]
    return out


def chat_title(chat: Chat, peer) -> str:
    if not peer:
        return chat.name
    if norm_name(chat.name) in norm_name(peer) or chat.name in ("Без названия", "Удалённый аккаунт"):
        return peer
    return f"{peer} ({chat.name})"


def best_window(marks: list, n_messages: int, size: int = WINDOW) -> dict:
    """Keyword, money and file counts of the most work-like stretch of `size` messages.

    A long friendly chat collects many work words over the years, but thinly; a project packs
    them into a few weeks. Sliding window over the marked messages, value as in score_chat."""
    lg = math.log2
    weights = [k[2] for k in KEYWORDS]

    def f(n):
        return min(lg(1 + n), 4)

    counts = [0] * len(KEYWORDS)
    cat_active = Counter()
    money = files = 0
    s_kw = 0.0
    best = {"kw": Counter(), "money": 0, "files": 0, "messages": min(n_messages, size)}
    best_value = -1.0
    left = 0
    for right, (num, labels, n_money, is_doc) in enumerate(marks):
        for i in labels:
            s_kw += weights[i] * (f(counts[i] + 1) - f(counts[i]))
            if counts[i] == 0:
                cat_active[KEYWORDS[i][1]] += 1
            counts[i] += 1
        money += n_money
        files += is_doc
        while marks[left][0] <= num - size:
            for i in marks[left][1]:
                s_kw -= weights[i] * (f(counts[i]) - f(counts[i] - 1))
                counts[i] -= 1
                if counts[i] == 0:
                    cat_active[KEYWORDS[i][1]] -= 1
            money -= marks[left][2]
            files -= marks[left][3]
            left += 1
        strong = sum(1 for c in STRONG_CATEGORIES if cat_active[c] > 0)
        value = s_kw + 2.0 * max(0, strong - 1) + 3.0 * min(lg(1 + money), 4) + 1.5 * min(lg(1 + files), 3)
        if value > best_value:
            best_value = value
            best = {"kw": Counter({KEYWORDS[i][0]: c for i, c in enumerate(counts) if c}),
                    "money": money, "files": files, "messages": min(n_messages, size)}
    return best


def _int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def score_chat(st: dict):
    """Score = how much the chat looks like paid freelance work.

    Counted over the best window W (the densest stretch of 300 messages, see best_window):
    S_kw    = sum over keywords k of  w_k * min(log2(1 + n_k), 4)   n_k = messages with keyword k
              (log + cap: one word repeated 500 times adds at most 4 * w_k)
    S_cat   = 2 * (C - 1), C = distinct "strong" categories hit (задача, деньги, документы, сроки, работа)
    S_money = 3   * min(log2(1 + money mentions), 4)
    S_files = 1.5 * min(log2(1 + shared documents), 3)
    In groups where 4 or more people talk about money (a trip, a shared flat), the "деньги" and
    "документы" keywords and S_money count half: that is splitting costs and receipts, not a client.
    Counted over the whole chat:
    S_calls = 1.5 * min(log2(1 + calls of 5+ minutes), 3) + 0.5 * min(log2(1 + shorter calls), 2)
    S_voice = 1   * min(log2(1 + minutes of voice and video notes), 4)
    S_size  = 0.5 * min(log2(1 + messages / 50), 3)
    S_span  = 0.5 if the chat lasts between a week and ~13 months (typical project), else 0
    S_open  = 3 if the first 10 messages already talk about the task, money or terms (the request)
    S_vy    = 4 * share of "вы" among "вы"/"ты" messages in a personal chat, if at least half and 3+
              messages (clients are often on "вы", friends on "ты")
    density D = 0.5 + 0.5 * min(1, (keyword messages + money mentions) in W / messages in W / 0.12)
              (a stretch with rare work words loses up to half of its score)
    score   = (S_kw + S_cat + S_money + S_files + S_calls + S_voice + S_size + S_span + S_open + S_vy) * D
    A chat has "signal" when it has a keyword from a strong category, a money mention or a shared
    document. Product words alone (игра, сайт, бот) are common in friendly chats and do not count.
    """
    lg = math.log2
    weights = {k[0]: k[2] for k in KEYWORDS}
    category = {k[0]: k[1] for k in KEYWORDS}
    win = st.get("window") or {"kw": st["kw"], "money": len(st["money"]), "files": len(st["files"]),
                               "messages": st["messages"]}
    split_costs = st.get("type") != "personal_chat" and len(st.get("money_senders") or ()) >= 4
    half = 0.5 if split_costs else 1.0
    s_kw = sum(weights[label] * min(lg(1 + n), 4) * (half if category[label] in ("деньги", "документы") else 1.0)
               for label, n in win["kw"].items())
    cats = {category[label] for label, n in win["kw"].items() if n}
    s_cat = 2.0 * max(0, len(cats & STRONG_CATEGORIES) - 1)
    s_money = 3.0 * min(lg(1 + win["money"]), 4) * half
    s_files = 1.5 * min(lg(1 + win["files"]), 3)
    long_calls = st.get("long_calls", 0)
    s_calls = 1.5 * min(lg(1 + long_calls), 3) + 0.5 * min(lg(1 + st["calls"] - long_calls), 2)
    s_voice = 1.0 * min(lg(1 + (st.get("voice_sec", 0) + st.get("round_sec", 0)) / 60), 4)
    n = max(st["messages"], 1)
    s_size = 0.5 * min(lg(1 + n / 50), 3)
    span_days = (st["last"] - st["first"]).days if st["first"] and st["last"] else 0
    s_span = 0.5 if 7 <= span_days <= 400 else 0.0
    s_open = 3.0 if st.get("opening") else 0.0
    vy, ty = st.get("formal", 0), st.get("informal", 0)
    share = vy / (vy + ty) if vy + ty >= 3 else 0.0
    s_vy = 4.0 * share if share >= 0.5 else 0.0
    hits = sum(win["kw"].values()) + win["money"]
    density = 0.5 + 0.5 * min(1.0, hits / max(win["messages"], 1) / DENSITY_FULL)
    raw = s_kw + s_cat + s_money + s_files + s_calls + s_voice + s_size + s_span + s_open + s_vy
    all_cats = {category[label] for label, c in st["kw"].items() if c}
    signal = bool((all_cats & STRONG_CATEGORIES) or st["money"] or st["files"])
    return round(raw * density, 1), signal


# ----------------------------------------------------------------------------- report snippets

def snippet(text: str, start: int, end: int, width: int = 200):
    """(before, match, after) around [start:end], about `width` characters in total."""
    pad = max(20, (width - (end - start)) // 2)
    a, b = max(0, start - pad), min(len(text), end + pad)
    before, after = text[a:start], text[end:b]
    if a > 0:
        before = "…" + before.lstrip()
    if b < len(text):
        after = after.rstrip() + "…"
    return before.replace("\n", " "), text[start:end], after.replace("\n", " ")


def short(text: str, n: int) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def media_short(m: dict, rd=keep_text) -> str:
    kind = media_kind(m)
    dur = _int(m.get("duration_seconds"))
    return {
        "voice": f"[голосовое {fmt_clock(dur)}]",
        "round": f"[видеосообщение {fmt_clock(dur)}]",
        "photo": "[фото]",
        "document": f"[файл: {rd(file_display_name(m), filename=True)}]",
        "sticker": f"[стикер {m.get('sticker_emoji') or ''}]".replace(" ]", "]"),
        "animation": "[гифка]",
        "video_file": f"[видео {fmt_clock(dur)}]",
        "audio_file": "[аудио]",
        "contact": "[контакт]",
        "location": "[геопозиция]",
        "poll": "[опрос]",
    }.get(kind, "")


def report_items(chat: Chat, st: dict, me_ids: set, do_redact: bool = True) -> dict:
    """First messages, keyword snippets and money snippets for the HTML report (redacted)."""
    rd = redact if do_redact else keep_text
    msgs = chat.messages

    def who(m):
        fid, name = sender_of(m)
        return "Я" if fid in me_ids else (name or "Удалённый аккаунт")

    first = []
    for idx in st["first_msgs"]:
        m = msgs[idx]
        text = rd(message_text(m, links=True))
        body = " ".join(x for x in (media_short(m, rd), short(text, 400)) if x)
        first.append({"date": _dts(msg_dt(m)), "who": who(m), "text": body})
    # keyword snippets: one per keyword first (heaviest first), then more of the same
    by_label = {}
    for idx, i in st["kw_hits"]:
        by_label.setdefault(i, []).append(idx)
    order = sorted(by_label, key=lambda i: (-KEYWORDS[i][2], -st["kw"][KEYWORDS[i][0]]))
    picks = []
    for rnd in range(3):                             # one snippet per keyword, then second ones
        for i in order:
            lst = by_label[i]
            if len(picks) < 6 and rnd < len(lst) and lst[rnd] not in {p[0] for p in picks}:
                picks.append((lst[rnd], i))
    kw_snips = []
    for idx, i in sorted(picks):
        m = msgs[idx]
        text = rd(message_text(m, links=False))
        mm = KW_SINGLE[i].search(text)
        if not mm:
            continue
        b, x, a = snippet(text, mm.start(), mm.end())
        kw_snips.append({"date": _dts(msg_dt(m)), "who": who(m), "label": KEYWORDS[i][0],
                         "before": b, "match": x, "after": a})
    money_snips, seen_idx = [], set()
    for idx, _d, _amount in st["money"]:
        if idx in seen_idx or len(money_snips) >= 6:
            continue
        seen_idx.add(idx)
        m = msgs[idx]
        text = rd(message_text(m, links=False))
        sp = money_spans(text)
        if not sp:
            continue
        s, e, _ = sp[0]
        b, x, a = snippet(text, s, e, 180)
        money_snips.append({"date": _dts(msg_dt(m)), "who": who(m), "before": b, "match": x, "after": a})
    return {"first": first, "keywords": kw_snips, "money": money_snips}


def _dts(d) -> str:
    return d.strftime("%d.%m.%Y %H:%M") if d else ""


# ----------------------------------------------------------------------------- FIND

def prepare_out(out_arg) -> Path:
    out = Path(os.path.expanduser(out_arg)).resolve() if out_arg else DEFAULT_OUT
    if out.exists() and not out.is_dir():
        raise UserError(f"{out} существует и это не папка. Укажи другую в --out.")
    owned = out == DEFAULT_OUT or not out.exists()
    try:
        ensure_private_dir(out, owned)
    except OSError as e:
        raise UserError(f"Не могу создать папку {out}: {e.strerror or e}")
    for w in out_warnings(out):
        print("Внимание: " + w)
    return out


def chip_list(st: dict, n: int = 8) -> list:
    weights = {k[0]: k[2] for k in KEYWORDS}
    items = sorted(st["kw"].items(), key=lambda kv: (-weights[kv[0]] * min(math.log2(1 + kv[1]), 4), kv[0]))
    return items[:n]


def build_command(script: Path, export_path: Path, out: Path, me=None, nda_extra=None) -> tuple:
    prefix = f"uv run {sh_quote(str(script))} build {sh_quote(str(export_path))} --chats "
    suffix = ""
    if out != DEFAULT_OUT:
        suffix += f" --out {sh_quote(str(out))}"
    if me:
        suffix += f" --me {sh_quote(me)}"
    if nda_extra:
        suffix += f" --nda {sh_quote(', '.join(nda_extra))}"
    return prefix, suffix


def fmt_score(x) -> str:
    return f"{x:g}".replace(".", ",")


def print_load_warnings(exp: Export) -> None:
    for w in exp.warnings:
        print("Внимание: " + w)


def cmd_find(args) -> int:
    out = prepare_out(args.out)
    since = None
    if args.since:
        try:
            since = dt.datetime.strptime(args.since.strip(), "%Y-%m-%d")
        except ValueError:
            raise UserError(f"Дата в --since должна быть в виде ГГГГ-ММ-ДД, например 2022-01-01. Сейчас: «{args.since}».")
    nda_extra = parse_nda_words(args.nda)
    nda_re = make_nda_re(nda_extra)
    t0 = time.time()
    print("Читаю выгрузку...", flush=True)
    exp = load_export(args.export)
    print_load_warnings(exp)
    me_ids, me_name, how = detect_me(exp, args.me)
    kept = exp.kept
    skipped = Counter(SKIP_LABELS.get(c.type, "чаты неизвестного типа") for c in exp.chats if not c.kept)
    rows = []
    tty = sys.stdout.isatty()
    for n, chat in enumerate(kept, 1):
        if tty and len(kept) > 20:
            sys.stdout.write(f"\rСмотрю чаты: {n}/{len(kept)}")
            sys.stdout.flush()
        st = analyze_chat(chat, me_ids, since, nda_re)
        if since and st["messages"] == 0:
            continue
        st["items"] = report_items(chat, st, me_ids)
        rows.append(st)
    if tty and len(kept) > 20:
        sys.stdout.write("\r" + " " * 30 + "\r")
    rows.sort(key=lambda s: (-s["signal"], -s["voice_signal"], -s["score"], -s["messages"], s["title"].lower()))
    script = Path(__file__).resolve()
    prefix, suffix = build_command(script, exp.path, out, args.me, nda_extra)
    data = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "export": str(exp.path),
        "script": str(script),
        "me": {"ids": sorted(me_ids), "name": me_name, "how": how},
        "nda_extra": nda_extra,
        "command_prefix": prefix, "command_suffix": suffix,
        "chats_total": len(exp.chats), "chats_kept": len(kept),
        "chats": [row_json(s) for s in rows],
    }
    atomic_write_json(out / "candidates.json", data)
    page = render_report(data, rows, exp, nda_extra)
    report = out / "candidates.html"
    atomic_write_text(report, page)
    # terminal summary
    cands = [s for s in rows if s["signal"]]
    voiced = [s for s in rows if s["voice_signal"]]
    print(f"Прочитал выгрузку: {exp.path}")
    hint = "" if exp.me_id or args.me else " Если это не ты, добавь --me 'Имя Фамилия'."
    print(f"Ты в переписке: {me_name} ({how}).{hint}")
    sk = ", ".join(f"{k} {v}" for k, v in skipped.most_common())
    print(f"Чатов в выгрузке: {len(exp.chats)}. Просмотрел личные чаты и частные группы: {len(kept)}."
          + (f" Пропустил: {sk}." if sk else ""))
    if exp.duplicates:
        print(f"Повторы одних и тех же чатов: {exp.duplicates}, взял самые полные копии.")
    print(f"Похожи на заказы: {len(cands)} {plural(len(cands), 'чат', 'чата', 'чатов')}.")
    if cands:
        print("Сверху отчёта:")
    for i, s in enumerate(cands[:5], 1):
        flag = f"  [NDA? проверь: {', '.join(nda_names(s))}]" if s["nda"] else ""
        print(f"  {i}. {s['title']} (балл {fmt_score(s['score'])}, {s['messages']} сообщ.){flag}")
    if voiced:
        print(f"Ещё {len(voiced)} {plural(len(voiced), 'чат', 'чата', 'чатов')} почти без слов о работе, "
              "но с голосовыми и звонками: они в отдельном разделе отчёта.")
    print(f"Отчёт: {report}  (за {time.time() - t0:.0f} с)")
    print()
    print("Что дальше:")
    print("  1. В отчёте отметь галочками чаты заказчиков.")
    print("  2. Внизу нажми «Скопировать команду».")
    print("  3. Вставь команду сюда, в Терминал, и нажми Enter.")
    if args.no_open:
        print(f"Открыть отчёт: open {sh_quote(str(report))}")
    else:
        try:
            webbrowser.open(report.as_uri())
        except Exception:
            pass
        print(f"Если отчёт не открылся сам, выполни: open {sh_quote(str(report))}")
    return 0


def row_json(s: dict) -> dict:
    return {
        "id": s["key"], "name": s["name"], "title": s["title"], "peer": s["peer"],
        "type": s["type"], "type_label": s["type_label"],
        "score": s["score"], "signal": s["signal"], "voice_signal": s["voice_signal"],
        "first": fmt_date(s["first"]), "last": fmt_date(s["last"]),
        "messages": s["messages"], "mine": s["mine"],
        "voices": s["voices"], "voice_min": round(s["voice_sec"] / 60, 1),
        "video_notes": s["rounds"], "video_note_min": round(s["round_sec"] / 60, 1),
        "calls": s["calls"], "call_min": round(s["call_sec"] / 60, 1), "long_calls": s["long_calls"],
        "missed_calls": s["missed_calls"],
        "money_mentions": len(s["money"]), "files": len(s["files"]),
        "keywords": dict(chip_list(s, 20)),
        "nda": s["nda"], "nda_hits": s["nda_hits"], "nda_in_name": s["nda_in_name"], "nda_words": nda_names(s),
        "snippets": s.get("items"),
    }


REPORT_CSS = """
:root{--bg:#f7f6f2;--fg:#1c1b19;--muted:#6b675f;--card:#fff;--line:#e4e0d7;--chip:#efece5;
--accent:#b9410e;--accent-fg:#fff;--on:#fff4ec;--warn-fg:#8a2c0d;--warn-bg:#fde6d8;--mark:#ffe27a;--mark-fg:#1c1b19;
--bar:#fffffff0;--shadow:0 -6px 24px #0000001a}
@media (prefers-color-scheme:dark){:root{--bg:#151412;--fg:#ecebe7;--muted:#a19c92;--card:#1f1e1b;--line:#34322d;
--chip:#2b2925;--accent:#f0773f;--accent-fg:#151412;--on:#2a1f18;--warn-fg:#ffb48f;--warn-bg:#3a2015;--mark:#7a5d00;--mark-fg:#fff6d5;
--bar:#1f1e1bf2;--shadow:0 -6px 24px #00000080}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding-bottom:190px}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;line-height:1.2;margin:0 0 8px}
h2{font-size:18px;margin:28px 0 12px}
h4{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 6px}
p{margin:6px 0}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--chip);padding:1px 5px;border-radius:5px;word-break:break-all}
.lead{color:var(--muted)}
.how{margin:10px 0;padding-left:22px}
.note{background:var(--warn-bg);color:var(--warn-fg);padding:8px 12px;border-radius:8px;font-size:14px}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 4px;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}
input[type=search]{flex:1 1 240px;min-width:0;font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button:hover{border-color:var(--accent)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}
button:disabled{opacity:.45;cursor:default}
.chat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}
.chat.on{border-color:var(--accent);background:var(--on)}
.head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;cursor:pointer}
.head input{transform:scale(1.25);margin:0 4px 0 0;align-self:center}
.name{font-weight:650;font-size:16px;overflow-wrap:anywhere}
.tag{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:0 8px}
.score{margin-left:auto;font-size:13px;color:var(--muted);white-space:nowrap}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--muted);font-size:13.5px;margin:6px 0 0 30px}
.chips{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0 30px;padding:0}
.chips li{background:var(--chip);border-radius:20px;padding:1px 9px;font-size:13px}
.nda{margin:8px 0 0 30px;background:var(--warn-bg);color:var(--warn-fg);border-radius:8px;padding:6px 10px;font-size:14px}
.hint{margin:8px 0 0 30px;color:var(--muted);font-size:14px}
details.more{margin:8px 0 0 30px}
details.more summary{cursor:pointer;color:var(--accent);font-size:14px}
ul.lines{list-style:none;padding:0;margin:0}
ul.lines li{padding:4px 0;border-top:1px solid var(--line);font-size:14px;overflow-wrap:anywhere}
ul.lines li:first-child{border-top:0}
.when{color:var(--muted);font-size:12.5px;margin-right:6px;white-space:nowrap}
mark{background:var(--mark);color:var(--mark-fg);border-radius:3px;padding:0 2px}
details.rest{margin-top:26px}
details.rest>summary{cursor:pointer;font-size:17px;font-weight:600}
.empty{color:var(--muted)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--bar);border-top:1px solid var(--line);box-shadow:var(--shadow);z-index:5;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.bar-in{max-width:980px;margin:0 auto;padding:10px 16px 12px;display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center}
.bar textarea{grid-column:1/2;width:100%;min-width:0;resize:none;font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:7px 9px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.bar .count{grid-column:1/3;font-weight:600}
.bar .copy{grid-column:2/3;grid-row:2/3;display:flex;flex-direction:column;align-items:center;gap:4px}
.copied{font-size:13px;color:var(--accent);min-height:1.2em}
.bar .warn{grid-column:1/3;color:var(--warn-fg);font-size:13px;margin:0}
@media (max-width:600px){.bar-in{grid-template-columns:1fr}.bar .copy{grid-column:1/2;grid-row:auto;flex-direction:row}.meta,.chips,.nda,.hint,details.more{margin-left:0}}
footer{color:var(--muted);font-size:13px;margin-top:30px}
"""

REPORT_JS = r"""
(function(){
  var CMD = JSON.parse(document.getElementById('cmd-data').textContent);
  var boxes = Array.prototype.slice.call(document.querySelectorAll('input[data-chat]'));
  var cmd = document.getElementById('cmd'), count = document.getElementById('count');
  var copyBtn = document.getElementById('copy'), copied = document.getElementById('copied');
  var warn = document.getElementById('ndawarn');
  function update(){
    var ids = [], names = [], nda = false;
    boxes.forEach(function(b){
      var card = b.closest('.chat');
      if (b.checked){
        ids.push(b.value);
        names.push(card ? card.querySelector('.name').textContent : b.value);
        if (b.getAttribute('data-nda') === '1') nda = true;
      }
      if (card) card.classList.toggle('on', b.checked);
    });
    var list = names.slice(0, 6).join(', ') + (names.length > 6 ? ' и ещё ' + (names.length - 6) : '');
    count.textContent = 'Выбрано чатов: ' + ids.length + (ids.length ? '. ' + list : '');
    cmd.value = ids.length ? CMD.prefix + ids.join(',') + CMD.suffix : '';
    copyBtn.disabled = !ids.length;
    warn.hidden = !nda;
  }
  boxes.forEach(function(b){ b.addEventListener('change', update); });
  document.getElementById('top10').addEventListener('click', function(){
    var n = 0;
    boxes.forEach(function(b){
      if (b.getAttribute('data-main') === '1' && b.getAttribute('data-nda') !== '1' && n < 10){ b.checked = true; n++; }
    });
    update();
  });
  document.getElementById('none').addEventListener('click', function(){
    boxes.forEach(function(b){ b.checked = false; }); update();
  });
  function norm(s){ return (s || '').toLowerCase().replace(/ё/g, 'е'); }
  var q = document.getElementById('q');
  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
  q.addEventListener('input', function(){
    var v = norm(q.value.trim());
    sections.forEach(function(sec){
      var shown = 0;
      sec.querySelectorAll('.chat').forEach(function(c){
        var hit = !v || norm(c.getAttribute('data-search')).indexOf(v) !== -1;
        c.hidden = !hit;
        if (hit) shown++;
      });
      var n = sec.querySelector('[data-count]'), empty = sec.querySelector('[data-empty]');
      if (n) n.textContent = shown;
      if (empty) empty.hidden = shown > 0 || !v;
      if (sec.tagName === 'DETAILS' && v && shown) sec.open = true;
    });
  });
  function done(ok){
    copied.textContent = ok ? 'Скопировано. Вставь в Терминал.' : 'Не вышло. Выдели текст и нажми Cmd+C.';
    clearTimeout(done.t); done.t = setTimeout(function(){ copied.textContent = ''; }, 4000);
  }
  function fallback(){
    cmd.focus(); cmd.select(); cmd.setSelectionRange(0, cmd.value.length);
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    done(ok);
  }
  copyBtn.addEventListener('click', function(){
    if (!cmd.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(cmd.value).then(function(){ done(true); }, fallback);
    } else { fallback(); }
  });
  update();
})();
"""


def _e(s) -> str:
    return html.escape(str(s if s is not None else ""), quote=True)


def nda_warning(s: dict) -> str:
    """«упоминается Tixu (в названии чата и 3 раза в переписке)» for the report and the terminal."""
    names = " или ".join(nda_names(s)) or "слово из списка NDA"
    where = []
    if s["nda_in_name"]:
        where.append("в названии чата")
    if s["nda_hits"]:
        where.append(f"{s['nda_hits']} {plural(s['nda_hits'], 'раз', 'раза', 'раз')} в переписке")
    return f"упоминается {names} ({' и '.join(where)})"


def render_card(s: dict, section: str) -> str:
    it = s.get("items") or {}
    if s["messages"]:
        stats = [fmt_period(s["first"], s["last"]),
                 f"{s['messages']} {plural(s['messages'], 'сообщение', 'сообщения', 'сообщений')}"]
    else:
        stats = ["нет сообщений"]
    if s["voices"]:
        stats.append(f"голосовых {s['voices']} ({fmt_minutes(s['voice_sec'])})")
    if s["rounds"]:
        stats.append(f"видеосообщений {s['rounds']} ({fmt_minutes(s['round_sec'])})")
    if s["calls"] or s["missed_calls"]:
        stats.append(f"звонков {s['calls']} ({fmt_minutes(s['call_sec'])})")
    if s["money"]:
        stats.append(f"деньги: {len(s['money'])}")
    if s["files"]:
        stats.append(f"файлов {len(s['files'])}")
    stats.append(f"id {s['key']}")
    chips = "".join(f"<li>{_e(k)} ×{v}</li>" for k, v in chip_list(s))
    notes = ""
    if s["nda"]:
        names = " или ".join(nda_names(s))
        notes += (f'<p class="nda">Внимание: {_e(nda_warning(s))}. Если это рабочий чат {_e(names)}, не бери его. '
                  f'Такие чаты сами не отмечаются: поставь галочку, только если это фриланс.</p>')
    if section == "voice":
        notes += (f'<p class="hint">Слов о работе в тексте почти нет, зато голосовых и видеосообщений на '
                  f'{fmt_minutes(s["voice_sec"] + s["round_sec"])}, долгих звонков: {s["long_calls"]}. '
                  f'О заказе могли говорить голосом.</p>')

    def lines(items, kind):
        out = []
        for x in items:
            if kind == "first":
                body = _e(x["text"])
            else:
                body = f"{_e(x['before'])}<mark>{_e(x['match'])}</mark>{_e(x['after'])}"
            out.append(f'<li><span class="when">{_e(x["date"])}</span><b>{_e(x["who"])}:</b> {body}</li>')
        return "<ul class=\"lines\">" + "".join(out) + "</ul>"

    more = ""
    parts = []
    if it.get("first"):
        parts.append("<h4>Начало переписки</h4>" + lines(it["first"], "first"))
    if it.get("keywords"):
        parts.append("<h4>Ключевые слова</h4>" + lines(it["keywords"], "kw"))
    if it.get("money"):
        parts.append("<h4>Деньги</h4>" + lines(it["money"], "money"))
    if parts:
        more = '<details class="more"><summary>Подробнее</summary>' + "".join(parts) + "</details>"
    search = f"{s['title']} {s['name']} {s['key']}"
    return (
        f'<article class="chat" data-search="{_e(search)}">'
        f'<label class="head"><input type="checkbox" data-chat value="{_e(s["key"])}" '
        f'data-nda="{1 if s["nda"] else 0}" data-main="{1 if section == "main" else 0}">'
        f'<span class="name">{_e(s["title"])}</span><span class="tag">{_e(s["type_label"])}</span>'
        f'<span class="score" title="Чем выше, тем больше похоже на заказ">балл {fmt_score(s["score"])}</span></label>'
        f'<div class="meta">' + "".join(f"<span>{_e(x)}</span>" for x in stats) + "</div>"
        + (f'<ul class="chips">{chips}</ul>' if chips else "")
        + notes + more + "</article>"
    )


def script_json(obj) -> str:
    """JSON that is safe inside <script>: no "</script>" in a chat name can close the tag."""
    return json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def render_report(data: dict, rows: list, exp: Export, nda_extra: list) -> str:
    main = [s for s in rows if s["signal"]]
    voiced = [s for s in rows if s["voice_signal"]]
    rest = [s for s in rows if not s["signal"] and not s["voice_signal"]]
    cmd_data = script_json({"prefix": data["command_prefix"], "suffix": data["command_suffix"]})
    nda_words = ", ".join(sorted(set(NDA_DEFAULT.values())) + [w for w in nda_extra])
    gen = dt.datetime.now().strftime("%d.%m.%Y %H:%M")
    empty = '<p class="empty" data-empty hidden>Ничего не нашлось.</p>'
    cards_main = "".join(render_card(s, "main") for s in main) or '<p class="empty">Ничего похожего на заказы не нашёл.</p>'
    voice_block = ""
    if voiced:
        voice_block = (f'<section data-section="voice"><h2>Почти без текста, но с голосовыми и звонками '
                       f'(<span data-count>{len(voiced)}</span>)</h2>'
                       f'<p class="lead">Здесь чаты, где слов о работе в тексте нет, зато много голосовых или '
                       f'долгих звонков. Загляни: о заказе могли договариваться голосом.</p>'
                       + "".join(render_card(s, "voice") for s in voiced) + empty + "</section>")
    rest_block = ""
    if rest:
        rest_block = (f'<details class="rest" data-section="rest"><summary>Остальные чаты '
                      f'(<span data-count>{len(rest)}</span>): без признаков заказа</summary>'
                      + "".join(render_card(s, "rest") for s in rest) + empty + "</details>")
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Кандидаты в кейсы</title>
<style>{REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
<h1>Кандидаты в кейсы</h1>
<p class="lead">Выгрузка: <code>{_e(data['export'])}</code><br>
Ты в переписке: {_e(data['me']['name'])}. Просмотрел {len(rows)} {plural(len(rows), 'чат', 'чата', 'чатов')}, похожи на заказы: {len(main)}. Отчёт собран {gen}.</p>
<ol class="how">
<li>Отметь галочками чаты заказчиков. Открой «Подробнее», если не помнишь, что за чат.</li>
<li>Внизу нажми «Скопировать команду».</li>
<li>Вставь команду в Терминал и нажми Enter.</li>
</ol>
<p class="note">В этом файле куски переписки с клиентами. Не пересылай его, не выкладывай и не показывай Claude. Телефоны, почты, карты, пароли и ключи уже скрыты.</p>
<div class="tools">
<input type="search" id="q" placeholder="Поиск по имени или названию чата" aria-label="Поиск по имени или названию чата">
<button type="button" id="top10">Отметить топ-10 без NDA</button>
<button type="button" id="none">Снять все</button>
</div>
<section data-section="main">
<h2>Похожи на заказы (<span data-count>{len(main)}</span>)</h2>
{cards_main}
{empty}
</section>
{voice_block}
{rest_block}
<footer>
<p>Балл складывается из слов о работе (ТЗ, счёт, оплата, договор, сроки, правки, курс, сайт и других), сумм, файлов, звонков и голосовых. Слова считаются в самом рабочем отрезке чата из {WINDOW} сообщений, поэтому длинная дружеская переписка с редкими рабочими словами не обгоняет короткий заказ. Одно слово, повторённое сто раз, почти не поднимает балл. Отрезок, где рабочих слов мало, теряет до половины балла. Обращение на «вы» и просьба в первых сообщениях добавляют балл. В группах, где о деньгах пишут четыре человека и больше (поездка, общая квартира), деньги и документы весят вдвое меньше.</p>
<p>«Почти без текста»: в тексте нет слов о работе, но голосовых и видеосообщений на 10 минут и больше или хотя бы два звонка от 5 минут.</p>
<p>«Остальные чаты»: нет слов о задаче, деньгах, документах, сроках и правках, нет сумм и файлов, мало голосовых и звонков.</p>
<p>NDA: чат помечен, если в названии есть {_e(nda_words)} или эти слова встречаются в переписке {NDA_MIN_HITS} и больше раз. Упоминания считаются за всё время, даже с --since.</p>
<p>Отчёт работает без интернета и ничего никуда не отправляет.</p>
</footer>
</div>
<div class="bar">
<div class="bar-in">
<div class="count" id="count">Выбрано чатов: 0</div>
<textarea id="cmd" rows="3" readonly placeholder="Отметь чаты заказчиков, и здесь появится команда" aria-label="Команда для Терминала"></textarea>
<div class="copy"><button type="button" class="primary" id="copy" disabled>Скопировать команду</button><span class="copied" id="copied" aria-live="polite"></span></div>
<p class="warn" id="ndawarn" hidden>Среди отмеченных есть чаты с пометкой NDA. Убедись, что это фриланс, а не рабочие чаты.</p>
</div>
</div>
<script type="application/json" id="cmd-data">{cmd_data}</script>
<script>{REPORT_JS}</script>
</body>
</html>
"""


# ----------------------------------------------------------------------------- audio decoding

class NoAudioStream(Exception):
    pass


def decode_audio(path) -> "object":
    """Any Telegram voice (.ogg/opus) or round video (.mp4) to 16 kHz mono float32 numpy array.
    PyAV bundles FFmpeg, so no ffmpeg or brew is needed."""
    import av
    import numpy as np
    with av.open(str(path), mode="r") as container:      # no metadata_errors= (removed in av 19)
        if not container.streams.audio:
            raise NoAudioStream("no audio track")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        chunks = []
        frames = container.decode(stream)
        while True:
            try:
                frame = next(frames)
            except StopIteration:
                break
            except av.error.InvalidDataError:
                continue                                   # skip a broken packet
            frame.pts = None
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):               # flush
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, np.float32)
    return np.concatenate(chunks).astype(np.float32, copy=False)


def is_silent(audio) -> bool:
    import numpy as np
    return audio.size < SAMPLE_RATE * 0.3 or float(np.sqrt(np.mean(np.square(audio)))) < 1e-3


# Whisper "ghost" phrases on silence/music. A credit has a word or two after it ("Субтитры сделал
# DimaTorzok"), so the patterns allow only a few words: a long sentence is real speech.
_GHOSTS = [re.compile(p, re.I) for p in (
    r"^субтитры (сделал|делал|создавал|создал|добавил|подогнал|подготовил|подготовлены|сделаны|созданы|предоставлены)\b(?: \S+){0,2}$",
    r"^субтитры и перевод\b(?: \S+){0,3}$",
    r"^субтитры и корректура\b(?: \S+){0,3}$",
    r"^субтитры [а-я]\. ?[а-я]+$",
    r"^редактор субтитров\b(?: \S+){0,4}$",
    r"^корректор [а-я]\. ?[а-я]+$",
    r"^продолжение следует$",
    r"^смотрите продолжение\b(?: \S+){0,4}$",
    r"^спасибо за (просмотр|субтитры)$",
    r"^(подписывайтесь|подпишись|подписывайся)( на (канал|наш канал))?$",
    r"^ставьте лайки?$",
    r"^(динамичная|веселая|спокойная|грустная|тревожная|напряженная|торжественная) музыка$",
    r"^(музыка|аплодисменты|смех)$",
    r"^(?:\S+ ){0,4}\S*amara\.?org\S*(?: \S+){0,2}$",
    r"^thanks? (you )?(so much )?for watching$",
    r"^please subscribe\b(?: \S+){0,4}$",
    r"^subtitles? by\b(?: \S+){0,4}$",
)]
# the most common credit glued to real speech in one segment: cut it off, keep the rest
_GHOST_PREFIX = re.compile(r"^\s*субтитры (?:сделал|делал|создавал|создал|добавил) dimatorzok\b[.!]?\s*", re.I)
# Short phrases Whisper also invents on noise. Kept, but marked as doubtful in the dossier.
_WHOLE_ONLY = re.compile(r"^(you|thank you|спасибо|спасибо за внимание|пока|поехали)$", re.I)
_SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+")


def _norm_sentence(s: str) -> str:
    s = s.strip().strip(" \t\n.,!?…-–—:;\"'«»()[]*").lower().replace("ё", "е")
    return re.sub(r"\s+", " ", s)


def is_ghost(sentence: str) -> bool:
    n = _norm_sentence(sentence)
    return bool(n) and any(p.match(n) for p in _GHOSTS)


def is_doubtful(text: str) -> bool:
    """The whole transcript is "Спасибо!" or "you": often noise, sometimes real."""
    return bool(_WHOLE_ONLY.match(_norm_sentence(text or "")))


def join_segments(texts) -> str:
    """Whisper segments to one text. A segment that is a whole ghost phrase is dropped wherever it
    is: Whisper writes such credits as separate segments, often without final punctuation."""
    return clean_hallucinations(" ".join(t.strip() for t in texts if t and t.strip() and not is_ghost(t)))


def clean_hallucinations(text: str) -> str:
    text = _GHOST_PREFIX.sub("", (text or "").strip())
    parts = [p for p in _SENT_SPLIT.split(text) if p.strip()]
    while parts and is_ghost(parts[0]):
        parts.pop(0)
    while parts and is_ghost(parts[-1]):
        parts.pop()
    return " ".join(parts).strip()


def keep_segment(no_speech_prob, avg_logprob) -> bool:
    try:
        return not (float(no_speech_prob) > 0.6 and float(avg_logprob) < -1.0)
    except (TypeError, ValueError):
        return True


# ----------------------------------------------------------------------------- engines

MLX_DEFAULT = "mlx-community/whisper-large-v3-turbo"
MLX_ALIASES = {"turbo": MLX_DEFAULT, "large-v3-turbo": MLX_DEFAULT,
               "turbo-q4": "mlx-community/whisper-large-v3-turbo-q4"}
FW_DEFAULT = "large-v3-turbo"            # faster-whisper alias for mobiuslabsgmbh/faster-whisper-large-v3-turbo
FW_PATTERNS = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]
MODEL_SIZE_NOTE = "около 1,6 ГБ"
TURBO_REPOS = {MLX_DEFAULT, "mobiuslabsgmbh/faster-whisper-large-v3-turbo"}


def fetch_model(repo: str, patterns, required) -> str:
    """Local folder of a Hugging Face model: from the cache without network, else download once."""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        return repo

    def complete(p):
        return p and all(any((Path(p) / alt).is_file() for alt in group.split("|")) for group in required)

    try:
        local = snapshot_download(repo, local_files_only=True, allow_patterns=patterns)
        if complete(local):
            return local
    except Exception:
        pass
    size = f", {MODEL_SIZE_NOTE}" if repo in TURBO_REPOS else ""
    print(f"  Скачиваю модель {repo}{size}. Это один раз: на медленном интернете до 20 минут. "
          "Дальше модель берётся с диска.", flush=True)
    local = snapshot_download(repo, allow_patterns=patterns)
    if not complete(local):
        raise UserError(f"Модель {repo} скачалась не полностью. Запусти команду ещё раз.")
    return local


class FakeEngine:
    """Hidden test engine: deterministic text, loads nothing, needs neither av nor numpy."""
    name, label, model = "fake", "тестовый движок", "fake"
    calls = 0

    def load(self):
        pass

    def transcribe_file(self, path, language, duration):
        FakeEngine.calls += 1
        stem = Path(path).name.split("@")[0]
        return f"тестовая расшифровка {stem}, {int(duration)} с", float(duration or 0)


class DecodeError(Exception):
    """The audio file itself is broken: cached, so a rerun does not load the model for it again."""


class _WhisperEngine:
    name = label = model = ""

    def transcribe_file(self, path, language, duration):
        try:
            audio = decode_audio(path)
        except NoAudioStream:
            raise
        except Exception as e:
            raise DecodeError(f"{type(e).__name__}: {e}") from e
        sec = audio.size / SAMPLE_RATE
        if is_silent(audio):
            return "", sec
        return self._transcribe(audio, language), sec


class MlxEngine(_WhisperEngine):
    name, label = "mlx", "mlx-whisper на видеокарте Apple"

    def __init__(self, model=None):
        m = model or MLX_DEFAULT
        if Path(os.path.expanduser(m)).is_dir():
            self.model = str(Path(os.path.expanduser(m)))
        elif m in MLX_ALIASES or "/" in m:
            self.model = MLX_ALIASES.get(m, m)
        else:
            raise UserError(f"Для движка mlx укажи модель полным именем, например {MLX_DEFAULT}.")
        self.path = self.model

    def load(self):
        import mlx.core as mx
        if not Path(self.path).is_dir():
            self.path = fetch_model(self.model, ["*.json", "weights.safetensors", "weights.npz"],
                                    ["config.json", "weights.safetensors|weights.npz"])
        try:
            from mlx_whisper.transcribe import ModelHolder
            ModelHolder.get_model(self.path, mx.float16)       # loads once, transcribe() reuses it
        except ImportError:
            pass

    def _transcribe(self, audio, language):
        import mlx_whisper
        r = mlx_whisper.transcribe(
            audio, path_or_hf_repo=self.path, language=language, verbose=None,
            condition_on_previous_text=False, temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
            no_speech_threshold=0.6, compression_ratio_threshold=2.4, logprob_threshold=-1.0,
        )
        segs = r.get("segments") or []
        if not segs:
            return join_segments([r.get("text") or ""])
        return join_segments(s.get("text") or "" for s in segs
                             if keep_segment(s.get("no_speech_prob", 0), s.get("avg_logprob", 0)))


class FasterEngine(_WhisperEngine):
    name, label = "faster", "faster-whisper на процессоре"

    def __init__(self, model=None):
        m = model or FW_DEFAULT
        self.model = str(Path(os.path.expanduser(m))) if Path(os.path.expanduser(m)).is_dir() else m
        self.whisper = None

    def load(self):
        from faster_whisper import WhisperModel
        path = self.model
        if not Path(path).is_dir():
            repo = path if "/" in path else None
            if repo is None:
                try:
                    from faster_whisper.utils import _MODELS
                    repo = _MODELS.get(path)
                except ImportError:
                    repo = None
            if repo:
                path = fetch_model(repo, FW_PATTERNS, ["model.bin", "config.json", "tokenizer.json"])
        threads = max(4, (os.cpu_count() or 8) // 2)
        self.whisper = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads)

    def _transcribe(self, audio, language):
        segments, _info = self.whisper.transcribe(
            audio, language=language, beam_size=5, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500}, condition_on_previous_text=False,
        )
        # segments is a lazy generator: the work happens while iterating
        return join_segments(s.text for s in segments if keep_segment(s.no_speech_prob, s.avg_logprob))


NO_ENGINE_HINT = (
    "Для расшифровки голосовых нужны библиотеки распознавания речи, а их нет. "
    "Запусти скрипт через uv: uv run tg_cases.py build ... (uv сам поставит всё нужное). "
    "Или добавь --no-voice, чтобы собрать досье без расшифровки."
)


def make_engine(name: str, model=None):
    if name == "fake":
        return FakeEngine()
    if name in ("auto", "mlx", "faster") and not (has_module("av") and has_module("numpy")):
        raise UserError(NO_ENGINE_HINT)
    if name == "auto":
        if is_apple_silicon() and has_module("mlx_whisper"):
            name = "mlx"
        elif has_module("faster_whisper"):
            name = "faster"
        else:
            raise UserError(NO_ENGINE_HINT)
    if name == "mlx":
        if not has_module("mlx_whisper"):
            raise UserError("mlx-whisper не установлен. Он работает только на Mac с процессором M1 и новее. "
                            "Запусти через uv run без --engine или с --engine faster.")
        return MlxEngine(model)
    if name == "faster":
        if not has_module("faster_whisper"):
            raise UserError("faster-whisper не установлен. Запусти через uv run без --engine: "
                            "на Mac с M1 и новее uv ставит mlx-whisper.")
        return FasterEngine(model)
    raise UserError(f"Неизвестный движок «{name}». Варианты: auto, mlx, faster.")


def rosetta_hint() -> str:
    if sys.platform != "darwin" or platform.machine() != "x86_64":
        return ""
    try:
        import subprocess
        r = subprocess.run(["sysctl", "-n", "sysctl.proc_translated"], capture_output=True, text=True, timeout=3)
        if r.stdout.strip() == "1":
            return ("Python запущен через Rosetta, расшифровка пойдёт медленно. Как это исправить: README, "
                    "раздел «Если что-то пошло не так», пункт «Скрипт пишет про Rosetta».")
    except Exception:
        pass
    return ""


# ----------------------------------------------------------------------------- transcription

class VoiceItem:
    __slots__ = ("chat", "msg", "kind", "rel", "path", "size", "duration", "key")

    def __init__(self, chat, msg, kind, rel, path):
        self.chat, self.msg, self.kind, self.rel, self.path = chat, msg, kind, rel, path
        self.size = path.stat().st_size if path else 0
        self.duration = _int(msg.get("duration_seconds"))
        # chat id + message id + size: survives a new export, where chats/chat_NNN/ gets renumbered
        mid = msg.get("id")
        self.key = f"{chat.key}|m{mid}|{self.size}" if mid is not None else f"{chat.key}|{rel}|{self.size}"


def voice_items(chat: Chat) -> list:
    items = []
    for m in chat.messages:
        kind = media_kind(m)
        if kind in ("voice", "round"):
            rel, path = media_file(m, chat.base)
            items.append(VoiceItem(chat, m, kind, rel, path))
    return items


def cache_hit(entry, engine_name, lang_opt: str = "auto") -> bool:
    if not isinstance(entry, dict) or "text" not in entry:
        return False
    if (entry.get("engine") == "fake") != (engine_name == "fake"):
        return False
    if lang_opt in ("ru", "en") and not entry.get("status") and entry.get("lang") != lang_opt:
        return False                       # --lang asks for another language: transcribe again
    return True


class Progress:
    def __init__(self, total_n: int, total_sec: float):
        self.total_n, self.total_sec = total_n, max(total_sec, 1.0)
        self.tty = sys.stdout.isatty()
        self.t0 = time.time()
        self.width = 0
        self.printed = None

    def show(self, done_n: int, done_sec: float, final: bool = False):
        el = time.time() - self.t0
        eta = ""
        if 0 < done_sec < self.total_sec and done_n:
            left = el / done_sec * (self.total_sec - done_sec)
            eta = f", осталось около {fmt_minutes(left)}" if left >= 60 else f", осталось около {int(left) + 1} сек"
        line = (f"  [{done_n}/{self.total_n}] расшифровано {fmt_clock(done_sec)} из {fmt_clock(self.total_sec)} "
                f"аудио{eta}")
        if self.tty:
            pad = max(0, self.width - len(line))
            sys.stdout.write("\r" + line + " " * pad + ("\n" if final else ""))
            sys.stdout.flush()
            self.width = len(line)
        elif (final or done_n == 1 or done_n % 10 == 0) and self.printed != done_n:
            print(line, flush=True)
            self.printed = done_n


MISSING_HINT = ("Как их выгрузить: README, раздел «Если что-то пошло не так», "
                "пункт «В досье (голосовое не выгружено)».")


def transcribe_all(chats, out: Path, engine_name: str, model, lang_opt: str, langs: dict, no_voice: bool) -> dict:
    """Returns {item key: cache entry}. Cache is written after every file, so Ctrl+C is safe."""
    cache_dir = out / ".cache"
    ensure_private_dir(cache_dir, True)
    cache_path = cache_dir / "transcripts.json"
    cache = read_json_or(cache_path, {})
    if not isinstance(cache, dict):
        cache = {}
    items = [it for c in chats for it in voice_items(c)]
    on_disk = [it for it in items if it.path]
    # --no-voice still reuses real transcripts made earlier
    lookup, lang_lookup = ("faster", "auto") if no_voice else (engine_name, lang_opt)
    todo = [it for it in on_disk if not cache_hit(cache.get(it.key), lookup, lang_lookup)]
    result = {it.key: cache[it.key] for it in on_disk if cache_hit(cache.get(it.key), lookup, lang_lookup)}
    missing = len(items) - len(on_disk)
    if items:
        msg = f"Голосовых и видеосообщений: {len(items)}"
        if missing:
            msg += f", не выгружено {missing}"
        if result:
            msg += f", уже расшифровано раньше {len(result)}"
        print(msg + ".")
        if missing:
            print("  " + MISSING_HINT)
    if not todo:
        return result
    if no_voice:
        print(f"Расшифровку пропускаю (--no-voice): {len(todo)} без текста.")
        return result
    engine = make_engine(engine_name, model)
    total_sec = sum(it.duration for it in todo)
    print(f"Расшифровываю {len(todo)}: {fmt_minutes(total_sec)} аудио. Движок: {engine.label}.")
    hint = rosetta_hint() if engine.name == "faster" else ""
    if hint:
        print("Внимание: " + hint)
    if engine.name != "fake":
        print(f"Загружаю модель распознавания {Path(engine.model).name}.", flush=True)
    try:
        engine.load()
    except UserError:
        raise
    except Exception as e:
        raise UserError(f"Не получилось загрузить модель распознавания: {e}. Проверь интернет и место на диске "
                        "(нужно около 3 ГБ) и запусти команду ещё раз. Или добавь --no-voice.")
    prog = Progress(len(todo), total_sec)
    done_sec = 0.0
    broken, failed, first_error = 0, 0, ""
    for n, it in enumerate(todo, 1):
        language = langs.get(it.chat.key) if lang_opt == "auto" else lang_opt
        stamp = dt.datetime.now().isoformat(timespec="seconds")
        try:
            text, sec = engine.transcribe_file(it.path, language, it.duration)
            entry = {"text": text, "engine": engine.name, "model": engine.model, "lang": language or "auto",
                     "sec": round(sec, 1), "at": stamp}
        except NoAudioStream:
            entry = {"text": "", "status": "noaudio", "engine": engine.name, "model": engine.model, "at": stamp}
        except DecodeError as e:
            broken += 1                                    # cached: the file will not get better
            entry = {"text": "", "status": "error", "error": str(e)[:200], "engine": engine.name, "at": stamp}
        except KeyboardInterrupt:
            raise
        except UserError:
            raise
        except Exception as e:
            failed += 1
            first_error = first_error or f"{it.path.name}: {type(e).__name__}: {e}"[:300]
            result[it.key] = {"text": "", "status": "failed", "error": str(e)[:200], "engine": engine.name}
            done_sec += it.duration
            prog.show(n, done_sec)
            continue                                       # engine errors are not cached: a rerun retries
        cache[it.key] = entry
        result[it.key] = entry
        atomic_write_json(cache_path, cache)
        done_sec += it.duration
        prog.show(n, done_sec)
    prog.show(len(todo), done_sec, final=True)
    if broken:
        print(f"Не читается файлов: {broken}. Они повреждены или выгружены не полностью, "
              "в досье помечены «(файл не читается)».")
    if failed:
        print(f"Не удалось расшифровать {failed}: ошибка распознавания. Первая ошибка: {first_error}. "
              "Запусти команду ещё раз. Если ошибка повторяется, добавь --no-voice.")
    return result


# ----------------------------------------------------------------------------- dossier rendering

def voice_label(it: VoiceItem, entry, no_voice: bool) -> str:
    noun = "голосовое" if it.kind == "voice" else "видеосообщение"
    head = f"[{noun} {fmt_clock(it.duration)}]"
    if not it.path:
        return f"{head} ({noun} не выгружено)"
    if entry is None:
        return f"{head} (не расшифровано)"
    status = entry.get("status")
    if status == "noaudio":
        return f"{head} (без звука)"
    if status == "error":
        return f"{head} (файл не читается)"
    if status == "failed":
        return f"{head} (не расшифровано: ошибка распознавания)"
    text = (entry.get("text") or "").strip()
    if not text:
        return f"{head} (не разобрать)"
    return f"{head} «{text}»" + (" (возможно, это шум, а не речь)" if is_doubtful(text) else "")


def media_label(m: dict, voice_labels: dict, rd=keep_text) -> str:
    kind = media_kind(m)
    if kind in ("voice", "round"):
        return voice_labels.get(id(m), "")
    dur = _int(m.get("duration_seconds"))
    if kind == "photo":
        return "[фото]"
    if kind == "document":
        return f"[файл: {rd(file_display_name(m), filename=True)}]"
    if kind == "sticker":
        e = m.get("sticker_emoji")
        return f"[стикер {e}]" if e else "[стикер]"
    if kind == "animation":
        return "[гифка]"
    if kind == "video_file":
        return f"[видео {fmt_clock(dur)}]" if dur else "[видео]"
    if kind == "audio_file":
        who = " – ".join(x for x in (m.get("performer"), m.get("title")) if isinstance(x, str) and x)
        return f"[аудио: {who or rd(file_display_name(m), filename=True)}]"
    if kind == "contact":
        ci = m.get("contact_information") or {}
        name = " ".join(x for x in (ci.get("first_name"), ci.get("last_name")) if isinstance(x, str) and x)
        phone = ci.get("phone_number") or ""
        return "[контакт: " + ", ".join(x for x in (name, phone) if x) + "]"
    if kind == "location":
        place = ", ".join(x for x in (m.get("place_name"), m.get("address")) if isinstance(x, str) and x)
        return f"[место: {place}]" if place else "[геопозиция]"
    if kind == "poll":
        p = m.get("poll") or {}
        q = flatten_text(p.get("question"), links=False)
        answers = []
        for a in p.get("answers") or []:
            if isinstance(a, dict):
                answers.append(f"{flatten_text(a.get('text'), links=False)} ({_int(a.get('voters'))})")
        return f"[опрос: «{q}»; варианты: " + "; ".join(answers) + "]"
    if kind == "game":
        return f"[игра: {m.get('game_title') or ''}]"
    if kind == "invoice":
        inv = m.get("invoice_information") or {}
        amount = _int(inv.get("amount"))
        return f"[счёт на оплату: {inv.get('title') or ''}, {amount / 100:g} {inv.get('currency') or ''}]".replace(" ,", ",")
    if kind == "todo":
        t = m.get("todo_list") or {}
        return f"[список задач: {flatten_text(t.get('title'), links=False) if isinstance(t, dict) else ''}]"
    if kind == "giveaway":
        return "[розыгрыш]"
    return ""


def service_label(m: dict):
    a = m.get("action")
    if a in ("phone_call", "conference_call"):
        dur = _int(m.get("duration_seconds"))
        return f"[звонок, {fmt_call(dur)}]" if dur > 0 else "[пропущенный звонок]"
    if a == "group_call":
        dur = _int(m.get("duration"))
        return f"[групповой звонок, {fmt_call(dur)}]" if dur > 0 else "[групповой звонок]"
    if a == "create_group":
        return f"[создал(а) группу «{m.get('title') or ''}»]"
    if a == "edit_group_title":
        return f"[новое название группы: «{m.get('title') or ''}»]"
    if a in ("invite_members", "remove_members"):
        members = ", ".join(x for x in (m.get("members") or []) if isinstance(x, str))
        verb = "добавил(а) в группу" if a == "invite_members" else "удалил(а) из группы"
        return f"[{verb}: {members}]" if members else f"[{verb}]"
    if a == "join_group_by_link":
        return "[вступил(а) в группу по ссылке]"
    return None


def _escape_md_line(text: str) -> str:
    return "\n".join(("\\" + ln) if ln.lstrip().startswith("#") else ln for ln in text.split("\n"))


def render_conversation(chat: Chat, me_ids: set, voice_labels: dict, rd) -> list:
    """Units: ("day", heading) and ("block", text). Same sender within an hour is merged."""
    msgs = [m for m in chat.messages if m.get("type") != "unsupported"]
    by_id = {}
    for m in msgs:
        if m.get("id") is not None:
            by_id[m.get("id")] = m
    units = []
    cur = None          # [day, sender key, last datetime, head, lines]
    day = None

    def flush():
        nonlocal cur
        if cur:
            units.append(("block", cur[3] + "\n".join(cur[4])))
        cur = None

    for m in msgs:
        d = msg_dt(m)
        mday = d.date() if d else None
        if mday != day and mday is not None:
            flush()
            day = mday
            units.append(("day", f"### {fmt_day(day)}"))
        fid, name = sender_of(m)
        who = "Я" if fid in me_ids else (name or "Удалённый аккаунт")
        hhmm = d.strftime("%H:%M") if d else "--:--"
        if m.get("type") == "service":
            label = service_label(m)
            if label:
                flush()
                units.append(("block", f"{hhmm} {who}: {label}"))
            continue
        parts = []
        if "forwarded_from" in m:
            src = m.get("forwarded_from")
            parts.append(f"[переслано, автор: {src.strip()}]" if isinstance(src, str) and src.strip()
                         else "[переслано, автор скрыт]")
        rid = m.get("reply_to_message_id")
        if rid is not None and m.get("reply_to_peer_id") is not None:
            parts.append("(в ответ на сообщение из другого чата)")     # ids there are not ours
        elif rid is not None and rid in by_id:
            orig = by_id[rid]
            otext = rd(message_text(orig, links=False)) or media_short(orig, rd)
            if otext.strip():
                parts.append(f"(в ответ на: «{short(otext, 60)}»)")
        ml = media_label(m, voice_labels, rd)
        if ml:
            parts.append(ml)
        text = message_text(m, links=True).strip()
        if text:
            parts.append(re.sub(r"\n{2,}", "\n", text))
        if m.get("via_bot"):
            parts.append(f"(через {m.get('via_bot')})")
        if not parts:
            continue
        body = _escape_md_line(rd(" ".join(parts)))
        skey = fid or who
        if cur and cur[0] == mday and cur[1] == skey and d and cur[2] and (d - cur[2]).total_seconds() <= 3600:
            cur[4].append(body)
            cur[2] = d
        else:
            flush()
            cur = [mday, skey, d, f"{hhmm} {who}: ", [body]]
    flush()
    return units


def voice_money(chat: Chat, transcripts: dict, rd) -> list:
    """[(date, amount, context)] for sums named in transcribed voice and video notes."""
    out = []
    for it in voice_items(chat):
        e = transcripts.get(it.key) if it.path else None
        text = rd((e or {}).get("text") or "")
        if not text or not _HAS_DIGIT.search(text):
            continue
        for s, e_, _amount in money_spans(text)[:3]:
            b, x, a = snippet(text, s, e_, 140)
            out.append((msg_dt(it.msg), x, (b + x + a).strip()))
    return out


def render_header(chat: Chat, st: dict, nn: int, me_name: str, voice_stats: dict, rd, redacted: bool,
                  spoken_money=()) -> str:
    L = []
    L.append(f"# {nn:02d}. {st['title']}")
    L.append("")
    note = (" Телефоны, почты, номера карт и счетов, паспорта, пароли и ключи заменены метками вроде [телефон]."
            if redacted else " Личные данные НЕ скрыты (--no-redact).")
    L.append(f"Досье для кейса портфолио. Собрано tg_cases.py {dt.date.today().strftime('%d.%m.%Y')} "
             f"из выгрузки Telegram.{note} «Я» в переписке: {me_name}.")
    L.append("")
    L.append(f"- Чат: {chat.name} ({chat.type_label}, id {chat.key})")
    span = (st["last"].date() - st["first"].date()).days + 1 if st["first"] and st["last"] else 0
    if span > 1:
        L.append(f"- Период: {fmt_period(st['first'], st['last'])}, {span} "
                 f"{plural(span, 'день', 'дня', 'дней')}, переписка в {st['active_days']} из них")
    elif span == 1:
        L.append(f"- Период: {fmt_period(st['first'], st['last'])}, один день")
    else:
        L.append("- Период: сообщений с датой нет")
    others = [(k, v) for k, v in st["senders"].most_common() if k != "Я"]
    L.append(f"- Сообщений: {st['messages']}, мои {st['mine']}, остальных {st['messages'] - st['mine']}")
    if chat.type == "personal_chat":
        if others:
            L.append(f"- Собеседник: {others[0][0]}")
    elif others:
        L.append("- Участники: Я (" + str(st["mine"]) + "), " + ", ".join(f"{k} ({v})" for k, v in others[:15]))
    if st["voices"] or st["rounds"]:
        vs = voice_stats
        kinds = []
        if st["voices"]:
            kinds.append(f"голосовые {st['voices']} ({fmt_clock(st['voice_sec'])})")
        if st["rounds"]:
            kinds.append(f"видеосообщения {st['rounds']} ({fmt_clock(st['round_sec'])})")
        status = [f"расшифровано {vs.get('ok', 0)}"]
        if vs.get("missing"):
            status.append(f"не выгружено {vs['missing']}")
        if vs.get("none"):
            status.append(f"без текста {vs['none']}")
        L.append("- Аудио: " + ", ".join(kinds) + "; " + ", ".join(status))
    if st["calls"] or st["missed_calls"]:
        L.append(f"- Звонки: {st['calls']}, всего {fmt_minutes(st['call_sec'])}; пропущенные: {st['missed_calls']}")
    chips = chip_list(st, 12)
    if chips:
        L.append("- Ключевые слова: " + ", ".join(f"{k} ×{v}" for k, v in chips))
    if st["nda_hits"] or st["nda_in_name"]:
        names = " или ".join(nda_names(st))
        L.append(f"- NDA: {nda_warning(st)}. Если это рабочий чат {names}, кейс не делать.")
    L.append("")
    # money
    L.append("## Деньги в переписке")
    L.append("")
    found, seen = [], set()
    for idx, d, _amount in st["money"]:
        if idx in seen:
            continue
        seen.add(idx)
        text = rd(message_text(chat.messages[idx], links=False))
        for s, e, amount in money_spans(text)[:3]:
            b, x, a = snippet(text, s, e, 140)
            found.append((d, f"«{x}»: {(b + x + a).strip()}"))
    for d, x, context in spoken_money:
        found.append((d, f"«{x}» (из голосового, проверь): {context}"))
    found.sort(key=lambda p: (p[0] is None, p[0] or dt.datetime.min))
    money_lines = [f"- {fmt_date(d)}, {line}" for d, line in found]
    if money_lines:
        L.extend(money_lines[:40])
        if len(money_lines) > 40:
            L.append(f"- и ещё {len(money_lines) - 40}, см. переписку")
    elif voice_stats.get("ok"):
        L.append("Сумм не нашёл ни в тексте, ни в расшифровках голосовых. Возможно, о деньгах говорили в звонках.")
    elif st["voices"] or st["rounds"]:
        L.append("Сумм в тексте не нашёл. Голосовые не расшифрованы: суммы могли называть в них или в звонках.")
    else:
        L.append("Сумм в переписке не нашёл. Возможно, о деньгах говорили в звонках.")
    L.append("")
    if st["files"]:
        L.append("## Файлы")
        L.append("")
        for _idx, d, who, fname in st["files"][:60]:
            L.append(f"- {fmt_date(d)}, {who}: {rd(fname, filename=True)}")
        if len(st["files"]) > 60:
            L.append(f"- и ещё {len(st['files']) - 60}")
        L.append("")
    links = []
    seen_u = set()
    for m in chat.messages:
        for u in message_links(m):
            if u not in seen_u:
                seen_u.add(u)
                links.append(u)
    if links:
        groups = {}
        for u in links:
            groups.setdefault(url_domain(u), []).append(u)
        L.append("## Ссылки")
        L.append("")
        shown = 0
        for dom, us in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            if shown >= 80:
                L.append(f"- и ещё {len(links) - shown} ссылок")
                break
            L.append(f"{dom} ({len(us)}):")
            for u in us[:15]:
                L.append(f"- {rd(u)}")
                shown += 1
            if len(us) > 15:
                L.append(f"- и ещё {len(us) - 15} на {dom}")
            L.append("")
        L.append("")
    return "\n".join(L).rstrip() + "\n"


def dossier_names(nn: int, slug: str, parts: int) -> list:
    """01-anna.md, or 03-igor.part1.md ... part2.md; part01 ... part12 when there are 10 parts or more."""
    if parts == 1:
        return [f"{nn:02d}-{slug}.md"]
    width = len(str(parts)) if parts >= 10 else 1
    return [f"{nn:02d}-{slug}.part{k:0{width}d}.md" for k in range(1, parts + 1)]


def split_units(header: str, units: list, chat_name: str, nn: int, slug: str, limit: int = SPLIT_LIMIT) -> list:
    """Returns file texts: one file if it fits, else parts with 'часть K из N' in the title."""
    body = "\n\n".join(text for _kind, text in units)
    single = header + "\n## Переписка\n\n" + body + "\n"
    if len(single) <= limit:
        return [single]
    reserve = 600                                    # room for the part title and intro line

    def cap(k):
        return max(10_000, (limit - len(header) - reserve) if k == 0 else (limit - reserve))

    pieces = []
    hard = cap(0) - 400                              # a giant single message is cut into chunks
    for kind, text in units:
        if len(text) <= hard:
            pieces.append((kind, text))
        else:
            pieces.extend(("block", text[i:i + hard]) for i in range(0, len(text), hard))
    parts, cur, size, last_day = [], [], 0, None
    for kind, text in pieces:
        if cur and size + len(text) + 2 > cap(len(parts)):
            parts.append(cur)
            cur, size = [], 0
            if last_day and kind != "day":
                cont = last_day + " (продолжение)"
                cur.append(cont)
                size += len(cont) + 2
        cur.append(text)
        size += len(text) + 2
        if kind == "day":
            last_day = text
    if cur:
        parts.append(cur)
    total = len(parts)
    title = f"# {nn:02d}. {chat_name}"
    first_file = dossier_names(nn, slug, total)[0]
    files = []
    for k, chunk in enumerate(parts, 1):
        if k == 1:
            head = header.replace(title + "\n", f"{title}, часть 1 из {total}\n", 1)
        else:
            head = (f"{title}, часть {k} из {total}\n\nПродолжение досье. Сводка по чату (деньги, файлы, ссылки) "
                    f"в файле {first_file}.\n")
        files.append(head + f"\n## Переписка, часть {k} из {total}\n\n" + "\n\n".join(chunk) + "\n")
    return files


# ----------------------------------------------------------------------------- BUILD

CLAUDE_MD = """# Черновики кейсов из переписки в Telegram

Этот файл создал tg_cases.py. Он пересоздаётся при каждом запуске build.

## Твоя роль

Ты помогаешь Даниилу превратить досье фриланс-проектов в черновики кейсов для портфолио imevstratov-pixel.github.io/portfolio. Досье собраны из его переписки с заказчиками. «Я» в досье — это Даниил.

## Что где лежит

- dossiers/00-сводка.md: список досье. Начни с него.
- dossiers/NN-slug.md: досье одного чата. Большое досье разбито на части NN-slug.part1.md, NN-slug.part2.md и дальше (если частей 10 и больше: part01, part02). Читай все части.
- cases/: сюда пиши результат.

Работай только с файлами этой папки. Файлы уровнем выше не открывай: candidates.html, candidates.json и папка .cache хранят переписку со всеми, в том числе чаты под NDA. Другие папки и файлы не меняй.

## Что сделать

1. Прочитай сводку и досье по очереди.
2. Для каждого досье реши, был ли это оплаченный заказ. Признаки: задача от заказчика, сроки, оплата, правки, сданный результат. Если это не заказ (дружеская переписка, бесплатная помощь, работа в штате), кейс не пиши, а объясни это в cases/00-обзор.md.
3. Для каждого заказа создай cases/NN-slug.md. NN-slug совпадает с именем досье, без .part1.
4. Один проект в нескольких чатах (личный чат и группа с командой заказчика): сделай один кейс, назови файл по первому досье и перечисли в «Чего не хватает» все досье, из которых он собран. Несколько разных заказов в одном чате: отдельный кейс на каждый, cases/NN-slug-2.md и дальше.
5. В конце создай cases/00-обзор.md: таблица всех досье с оценкой силы кейса от 1 до 5, что публиковать первым и почему, что нужно до публикации, какие чаты не заказы, какие под NDA.

Если файлы записать нельзя (например, в claude.ai прикрепили этот файл и одно досье), сделай кейс по прикреплённому досье и выдай его текстом в ответе.

## Формат файла кейса

Файл из двух частей. Первая часть до черты идёт на сайт. Вторая часть только для Даниила, на сайт её не переносят.

```
# Заголовок: сначала результат, конкретно

Происхождение: На заказ
Отрасль: например, онлайн-образование
Год: год или годы проекта по датам досье
Направление: Обучение, Разработка или Мост (одно)
Услуга на сайте: одно кодовое слово из списка ниже
Якорь: #case-english-a2-course

## Контекст
## Что сделал
## Результат
## Что из этого сделаю для вас

---

# Для Даниила, не публиковать

## Цифры и факты
## Чего не хватает
## Вопросы заказчику
## Сообщение заказчику
## Риски публикации
```

Заголовок: результат, а не процесс. Плохо: «Работа над курсом для школы». Хорошо: «Курс из 6 модулей для онлайн-школы английского за 5 недель».

Направление: Обучение (методология, курсы, аудит), Разработка (сайты, боты, приложения), Мост (на стыке: тренажёр, игра, AI-конвейер для обучения).

Якорь: #case- плюс 2-4 латинских слова о сути проекта через дефис, например #case-english-a2-course. Без имён людей, названий компаний и номеров досье. Имена файлов досье и кейсов содержат имя собеседника или название чата: не бери из них якорь и не переноси их в текст кейса.

Услуга на сайте, кодовое слово и как услуга называется на сайте:

- Аудит: Разбор курса и пути ученика
- Курс: Курс под ключ или пересборка готового контента
- Конвейер: AI-конвейер производства курсов
- Консультация: Консультация и методический фреймворк для команды
- Игра: Игра по вашей идее
- Приложение: Веб-приложение, сайт или интерактивный тренажёр под задачу
- Гайд: Тренажёр по нейросетям на делах близкого человека

Что писать в разделах:

- Контекст: кто заказчик (анонимно), какая была задача, почему она возникла. 2-4 предложения, один абзац.
- Что сделал: один абзац, 2-5 предложений, как на карточках сайта. Конкретные действия и что получилось на выходе.
- Результат: что изменилось у заказчика. Только то, что есть в досье. Если данных нет, напиши «Результат уточняю у заказчика» и добавь вопрос в «Вопросы заказчику».
- Что из этого сделаю для вас: одна строка с названием услуги, как на сайте. Ссылку не придумывай, её поставит Даниил. Например: «Соберу такой же курс для вашей школы: услуга «Курс под ключ или пересборка готового контента».»
- Цифры и факты: список «факт (досье, ДД.ММ.ГГГГ)». Сроки, объёмы, деньги, число модулей и уроков. Цифры и имена из расшифровок голосовых помечай «(из голосового, проверь)»: распознавание речи путает числа и имена. Цены и суммы попадают в публичную часть, только если заказчик согласился.
- Чего не хватает: вопросы Даниилу. Что он помнит сверх досье, где взять скриншоты, чем всё закончилось.
- Вопросы заказчику: 2-4 вопроса о результате: что изменилось, какие цифры можно назвать.
- Сообщение заказчику: короткое дружелюбное сообщение в Telegram. Обращение на «ты» или «вы», как в переписке. Попроси разрешения опубликовать кейс, предложи анонимный вариант без названия компании, попроси 1-2 предложения отзыва.
- Риски публикации: имена, чужой контент, коммерческие данные, NDA. Что убрать или согласовать до публикации.

## Правила

- Не выдумывай факты и цифры. У каждой цифры дата из досье: «45 000 ₽ (досье, 05.03.2026)».
- Догадку помечай словом «предположение».
- Заказчик анонимен по умолчанию: «онлайн-школа английского языка», а не название и не имя. Имена людей не пиши, пока заказчик не согласится.
- Материалы заказчика (тексты уроков, макеты, документы, переписку) не пересказывай подробнее, чем нужно для кейса.
- {NDA_RULE}
- Пиши от первого лица: «я собрал», «я переписал».
- Язык русский. Инфостиль: короткие конкретные предложения, глаголы вместо отглагольных существительных, без воды, без оценочных слов («уникальный», «инновационный», «потрясающий»).
- Не используй стрелки «→» и средние точки «·».
- Пробелы в данных отмечай в «Чего не хватает»: «(не разобрать)», «(голосовое не выгружено)», «(не расшифровано)». Пометка «(возможно, это шум, а не речь)» значит, что голосовое могло быть пустым.
- Метки [телефон], [email], [карта], [счёт], [паспорт], [пароль], [ключ] скрывают личные данные. Не пытайся их восстановить и не переноси в кейс.
"""


def nda_rule(extra: list) -> str:
    words = ", ".join(extra)
    tail = (f" Так же относись к чатам о работе, связанной со словами: {words}. Их Даниил отметил сам."
            if extra else "")
    return ("Работа в Tixu и Eduson под NDA. Если чат о работе в Tixu или Eduson, кейс не пиши и отметь это "
            "в обзоре. Если фриланс-чат только упоминает эти компании, кейс можно делать, но о них не пиши." + tail)


def claude_settings(out: Path) -> dict:
    """Claude Code project settings: never read the report or the transcript cache next door."""
    root = "/" + out.as_posix()                      # "//Users/..." is an absolute path in Claude Code rules
    return {"permissions": {"deny": [f"Read({root}/candidates.html)", f"Read({root}/candidates.json)",
                                     f"Read({root}/.cache/**)"]}}


def write_claude_settings(folder: Path, out: Path) -> None:
    path = folder / ".claude" / "settings.json"
    if path.exists():
        return                                        # his own settings: leave them alone
    ensure_private_dir(path.parent, True)
    atomic_write_json(path, claude_settings(out))


def write_summary(dd: Path, registry: dict, exp: Export, me_name: str, nda_extra=()) -> Path:
    rows = []
    for key, r in sorted(registry.get("chats", {}).items(), key=lambda kv: kv[1].get("nn", 0)):
        files = [f for f in r.get("files", []) if (dd / f).is_file()]
        if not files:
            continue
        rows.append((r, files))
    L = ["# Сводка по досье", ""]
    L.append(f"Обновлено {dt.datetime.now().strftime('%d.%m.%Y %H:%M')}. Последняя выгрузка: {exp.path}. "
             f"«Я» в переписке: {me_name}.")
    L.append("")
    L.append("| № | Чат | Тип | Период | Сообщений | Голосовых | Деньги | NDA | Файлы досье |")
    L.append("|---|---|---|---|---|---|---|---|---|")

    def cell(s):
        return str(s).replace("|", "\\|").replace("\n", " ")

    for r, files in rows:
        voices = f"{r.get('voices', 0)} ({fmt_minutes(r.get('voice_sec', 0))})" if r.get("voices") else "0"
        nda = ("проверь: " + ", ".join(r.get("nda_words") or [])).rstrip(": ") if r.get("nda") else ""
        L.append(f"| {r['nn']:02d} | {cell(r['name'])} | {cell(r['type_label'])} | {cell(r['period'])} | "
                 f"{r['messages']} | {voices} | {r['money']} | {nda} | {', '.join(files)} |")
    L.append("")
    if any(r.get("nda") for r, _ in rows):
        words = ", ".join(sorted(set(NDA_DEFAULT.values())) + list(nda_extra))
        L.append(f"NDA «проверь»: в чате упоминается одно из слов NDA ({words}). Кейс по рабочим чатам "
                 "этих компаний не делать.")
        L.append("")
    L.append("Как сделать черновики кейсов: инструкция в ../CLAUDE.md.")
    path = dd / "00-сводка.md"
    atomic_write_text(path, "\n".join(L) + "\n")
    return path


def parse_chat_ids(raw: str) -> list:
    ids = [x.strip() for x in re.split(r"[,\s;]+", raw or "") if x.strip()]
    out = []
    for x in ids:
        if x not in out:
            out.append(x)
    return out


def cmd_build(args) -> int:
    out = prepare_out(args.out)
    ws = out / WORKSPACE
    keys = parse_chat_ids(args.chats)
    if not keys:
        raise UserError("Не указаны чаты. Добавь --chats с номерами чатов через запятую: их даёт отчёт find.")
    exp = load_export(args.export)
    print_load_warnings(exp)
    me_ids, me_name, how = detect_me(exp, args.me)
    all_by_key = exp.by_key()
    chats, bad, skipped = [], [], []
    for k in keys:
        c = all_by_key.get(k)
        if c is None:
            bad.append(k)
        elif not c.kept:
            skipped.append(f"{k} ({c.name}: {c.type_label})")
        else:
            chats.append(c)
    if bad:
        raise UserError(
            "Не нашёл в выгрузке чаты с номерами: " + ", ".join(bad) + ". Номера чатов показывает отчёт: "
            "запусти find для этой же выгрузки, отметь чаты в candidates.html и скопируй команду кнопкой. "
            "Номер каждого чата написан в карточке после «id» и лежит в candidates.json."
        )
    if skipped:
        raise UserError("Эти чаты не обрабатываю (каналы, боты, публичные группы, Избранное): "
                        + ", ".join(skipped) + ". Убери их из --chats.")
    engine_name = (args.engine or "auto").strip().lower()
    if engine_name not in ("auto", "mlx", "faster", "fake"):
        raise UserError(f"Неизвестный движок «{args.engine}». Варианты: auto, mlx, faster.")
    print(f"Ты в переписке: {me_name} ({how}).")
    reg_path = out / ".cache" / "dossiers.json"
    ensure_private_dir(reg_path.parent, True)
    registry = read_json_or(reg_path, {"version": 1, "chats": {}})
    if not isinstance(registry, dict) or not isinstance(registry.get("chats"), dict):
        registry = {"version": 1, "chats": {}}
    # extra NDA words: from this command, else remembered from an earlier build, else from find's report
    if args.nda is not None:
        registry["nda_extra"] = parse_nda_words(args.nda)
    elif "nda_extra" not in registry:
        found = read_json_or(out / "candidates.json", {})
        if isinstance(found, dict) and isinstance(found.get("nda_extra"), list):
            registry["nda_extra"] = found["nda_extra"]
    nda_extra = [w for w in registry.get("nda_extra") or [] if isinstance(w, str)]
    nda_re = make_nda_re(nda_extra)
    stats = {c.key: analyze_chat(c, me_ids, nda_re=nda_re) for c in chats}
    langs = {c.key: stats[c.key]["lang"] for c in chats}
    transcripts = transcribe_all(chats, out, engine_name, args.model, args.lang, langs, args.no_voice)
    rd = keep_text if args.no_redact else redact
    ensure_private_dir(ws, True)
    dd = ws / "dossiers"
    ensure_private_dir(dd, True)
    reg = registry["chats"]
    written = []
    for chat in chats:
        st = stats[chat.key]
        entry = reg.get(chat.key)
        if entry:
            nn, slug = entry["nn"], entry["slug"]
        else:
            nn = max([r.get("nn", 0) for r in reg.values()] + [0]) + 1
            base = slugify(chat.name, f"chat-{chat.key}")
            taken = {r.get("slug") for k, r in reg.items() if k != chat.key}
            slug, n = base, 2
            while slug in taken:
                slug = f"{base}-{n}"
                n += 1
        vlabels, vstats = {}, Counter()
        for it in voice_items(chat):
            e = transcripts.get(it.key) if it.path else None
            vlabels[id(it.msg)] = voice_label(it, e, args.no_voice)
            if not it.path:
                vstats["missing"] += 1
            elif e and (e.get("text") or "").strip():
                vstats["ok"] += 1
            else:
                vstats["none"] += 1
        header = render_header(chat, st, nn, me_name, vstats, rd, not args.no_redact,
                               voice_money(chat, transcripts, rd))
        units = render_conversation(chat, me_ids, vlabels, rd)
        texts = split_units(header, units, st["title"], nn, slug)
        for old in (entry or {}).get("files", []):
            p = dd / old
            if re.fullmatch(r"\d{2,}-[a-z0-9\-]+(?:\.part\d+)?\.md", old) and p.is_file():
                p.unlink()
        names = dossier_names(nn, slug, len(texts))
        for name, text in zip(names, texts):
            atomic_write_text(dd / name, text)
        reg[chat.key] = {
            "nn": nn, "slug": slug, "files": names, "name": st["title"], "type_label": chat.type_label,
            "period": fmt_period(st["first"], st["last"]) if st["first"] else "нет сообщений",
            "messages": st["messages"],
            "voices": st["voices"] + st["rounds"], "voice_sec": st["voice_sec"] + st["round_sec"],
            "money": len(st["money"]), "nda": st["nda"], "nda_words": nda_names(st),
            "updated": dt.datetime.now().isoformat(timespec="seconds"),
        }
        atomic_write_json(reg_path, registry)
        written.append((st, names))
    summary = write_summary(dd, registry, exp, me_name, nda_extra)
    atomic_write_text(ws / "CLAUDE.md", CLAUDE_MD.replace("{NDA_RULE}", nda_rule(nda_extra)))
    write_claude_settings(ws, out)
    write_claude_settings(out, out)
    print()
    print(f"Готово: {len(written)} {plural(len(written), 'досье', 'досье', 'досье')}.")
    for st, names in written:
        if len(names) == 1:
            print(f"  {names[0]}: {st['title']}")
        else:
            print(f"  {names[0]} – {names[-1]}: {st['title']} "
                  f"({len(names)} {plural(len(names), 'часть', 'части', 'частей')})")
    print(f"Папка для Claude: {ws}")
    print(f"  {summary.relative_to(ws)}: список досье")
    print("  CLAUDE.md: инструкция для Claude")
    print("  cases/: сюда Claude сложит черновики кейсов")
    for st, _names in written:
        if st["nda"]:
            print(f"Внимание: {st['title']}: {nda_warning(st)}. Проверь, что это не рабочий чат.")
    print()
    print("Что дальше, вариант 1 (Claude Code):")
    print(f"  cd {sh_quote(str(ws))}")
    print("  claude")
    print("  и напиши: Прочитай CLAUDE.md и сделай черновики кейсов по всем досье")
    print("Вариант 2 (claude.ai): прикрепи CLAUDE.md и одно досье (все его части) и напиши: "
          "Сделай кейс по инструкции.")
    print(f"Отчёт find и кэш расшифровок лежат в {out}, вне папки для Claude: не прикрепляй их.")
    return 0


# ----------------------------------------------------------------------------- CLI

_ARGPARSE_RU = [
    ("the following arguments are required", "не хватает обязательных параметров"),
    ("unrecognized arguments", "лишние параметры"),
    ("invalid choice", "недопустимое значение"),
    ("expected one argument", "после параметра нужно значение"),
    ("argument ", "параметр "),
    ("choose from", "варианты"),
]
EXPORT_MISSING_HINT = ("Укажи папку выгрузки: набери команду, поставь пробел, перетащи папку выгрузки из Finder "
                       "в окно Терминала и только потом нажми Enter.")
SPACE_IN_PATH_HINT = ("Похоже, в пути к папке есть пробел, и Терминал разрезал путь на части. Путь с пробелами "
                      "вставляй перетаскиванием папки из Finder в окно Терминала или бери в одинарные кавычки: "
                      "'~/Downloads/Telegram Desktop/DataExport_2026-10-11'.")
CHATS_MISSING_HINT = "Номера чатов даёт отчёт find: отметь чаты галочками и скопируй команду кнопкой внизу."


class RuHelpFormatter(argparse.HelpFormatter):
    def add_usage(self, usage, actions, groups, prefix=None):
        return super().add_usage(usage, actions, groups, prefix if prefix is not None else "Запуск: ")


class RuParser(argparse.ArgumentParser):
    """argparse with Russian help, errors and hints for the usual typing slips."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("formatter_class", RuHelpFormatter)
        kwargs["add_help"] = False
        super().__init__(*args, **kwargs)
        self._positionals.title = "параметры"
        self._optionals.title = "ключи"
        self.add_argument("-h", "--help", action="help", help="показать эту справку")

    def error(self, message):
        hint = ""
        if "required" in message and "export" in message:
            hint = EXPORT_MISSING_HINT
        elif "required" in message and "--chats" in message:
            hint = CHATS_MISSING_HINT
        elif "unrecognized arguments" in message:
            hint = SPACE_IN_PATH_HINT
        for en, ru in _ARGPARSE_RU:
            message = message.replace(en, ru)
        self.print_usage(sys.stderr)
        sys.stderr.write(f"Ошибка в команде: {message}\n" + (hint + "\n" if hint else "")
                         + f"Справка: {self.prog} --help\n")
        sys.exit(2)


def make_parser() -> argparse.ArgumentParser:
    p = RuParser(prog="tg_cases.py",
                 description="Находит фриланс-заказы в выгрузке Telegram и готовит досье для кейсов портфолио.")
    sub = p.add_subparsers(dest="cmd", parser_class=RuParser, metavar="find|build")
    f = sub.add_parser("find", help="найти чаты, похожие на заказы, и открыть отчёт")
    f.add_argument("export", help="папка выгрузки Telegram или файл result.json")
    f.add_argument("--out", help="куда сохранить результат (по умолчанию ~/tg-cases)")
    f.add_argument("--since", help="учитывать сообщения с этой даты, ГГГГ-ММ-ДД")
    f.add_argument("--nda", help="дополнительные слова для пометки NDA, через запятую")
    f.add_argument("--me", help="твоё имя в Telegram, если скрипт определил тебя неверно")
    f.add_argument("--no-open", action="store_true", help="не открывать отчёт в браузере")
    b = sub.add_parser("build", help="собрать досье по выбранным чатам")
    b.add_argument("export", help="та же папка выгрузки или result.json")
    b.add_argument("--chats", required=True, help="номера чатов через запятую (из отчёта find)")
    b.add_argument("--out", help="папка результата (по умолчанию ~/tg-cases)")
    b.add_argument("--no-voice", action="store_true", help="не расшифровывать голосовые")
    b.add_argument("--engine", default="auto", metavar="auto|mlx|faster",
                   help="движок распознавания: auto (по умолчанию), mlx (Mac M1 и новее), faster (процессор)")
    b.add_argument("--model", help="модель Whisper (по умолчанию large-v3-turbo)")
    b.add_argument("--lang", default="auto", choices=["auto", "ru", "en"],
                   help="язык голосовых: auto (русский для русских чатов, иначе определит Whisper), ru, en")
    b.add_argument("--no-redact", action="store_true", help="не скрывать телефоны, почты, карты и пароли")
    b.add_argument("--me", help="твоё имя в Telegram, если скрипт определил тебя неверно")
    b.add_argument("--nda", help="дополнительные слова NDA, через запятую (запоминаются для следующих запусков)")
    return p


def main(argv=None) -> int:
    parser = make_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 2
    try:
        return cmd_find(args) if args.cmd == "find" else cmd_build(args)
    except UserError as e:
        sys.stdout.flush()
        print(f"\nОшибка: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        if args.cmd == "build":
            print("\nОстановлено. Готовые расшифровки сохранены: запусти ту же команду ещё раз (стрелка вверх "
                  "и Enter), и я продолжу с того же места.", file=sys.stderr)
        else:
            print("\nОстановлено.", file=sys.stderr)
        return 130
    except BrokenPipeError:
        # output piped into `head` and closed early: stop quietly
        try:
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        except OSError:
            pass
        return 1
    except MemoryError:
        print("\nОшибка: не хватило памяти. Выгрузи меньше чатов: только личные чаты и частные группы, "
              "без публичных групп и каналов.", file=sys.stderr)
        return 2
    except OSError as e:
        if getattr(e, "errno", None) == 28:
            print("\nОшибка: закончилось место на диске. Освободи несколько гигабайт и запусти ещё раз.",
                  file=sys.stderr)
            return 2
        raise


if __name__ == "__main__":
    sys.exit(main())
