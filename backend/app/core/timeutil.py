"""Date and duration helpers. Durations are integer minutes everywhere (C1)."""

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_DURATION_RE = re.compile(r"^\s*(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?\s*$", re.IGNORECASE)


def parse_duration(value: str | int | float) -> int:
    """Parse '1h 30m', '90m', '1.5h', '1:30' or a number of minutes into integer minutes."""
    if isinstance(value, (int, float)):
        return int(round(value))
    text = value.strip()
    if not text:
        raise ValueError("Duration is required")
    if re.fullmatch(r"\d+", text):
        return int(text)
    if re.fullmatch(r"\d+:\d{1,2}", text):
        h, m = text.split(":")
        return int(h) * 60 + int(m)
    m = _DURATION_RE.match(text)
    if not m or not (m.group(1) or m.group(2)):
        raise ValueError(f"Cannot read duration '{value}'. Use formats like 1h 30m, 90m or 1.5h")
    hours = float(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    return int(round(hours * 60)) + minutes


def format_minutes(minutes: int | None) -> str:
    if minutes is None:
        return "—"
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    return f"{sign}{minutes // 60}h {minutes % 60:02d}m"


def today_in(tz: str) -> date:
    return datetime.now(ZoneInfo(tz)).date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_end(d: date) -> date:
    return week_start(d) + timedelta(days=6)


def iso_week(d: date) -> int:
    return d.isocalendar()[1]


def daterange(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)
