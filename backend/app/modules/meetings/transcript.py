"""Transcript normalization: WebVTT (Teams) and simple 'HH:MM:SS Speaker: text' formats."""

import re
from dataclasses import dataclass

_TS = r"(\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?"
_VTT_CUE = re.compile(rf"^({_TS})\s*-->\s*({_TS})")
_VTT_VOICE = re.compile(r"^<v\s+([^>]+)>(.*?)(?:</v>)?$", re.S)
_PLAIN = re.compile(r"^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–]?\s*([^:]{1,80}):\s*(.+)$")
_TAG = re.compile(r"<[^>]+>")


@dataclass
class Segment:
    start: int
    end: int
    speaker: str
    text: str


def to_seconds(ts: str) -> int:
    parts = ts.split(".")[0].split(":")
    parts = [int(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def fmt_ts(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def _clean(text: str) -> str:
    # Strip markup so transcript content can never render as HTML (F1 sanitize).
    return re.sub(r"\s+", " ", _TAG.sub("", text)).strip()


def parse_transcript(raw: str) -> list[Segment]:
    raw = raw.replace("\r\n", "\n").replace("﻿", "")
    if raw.lstrip().startswith("WEBVTT") or "-->" in raw:
        return _parse_vtt(raw)
    return _parse_plain(raw)


def _parse_vtt(raw: str) -> list[Segment]:
    segments: list[Segment] = []
    blocks = re.split(r"\n\s*\n", raw)
    for block in blocks:
        lines = [ln for ln in block.strip().split("\n") if ln.strip()]
        for i, line in enumerate(lines):
            m = _VTT_CUE.match(line.strip())
            if not m:
                continue
            start, end = to_seconds(m.group(1)), to_seconds(m.group(3))
            body = " ".join(lines[i + 1:])
            vm = _VTT_VOICE.match(body.strip())
            if vm:
                speaker, text = vm.group(1).strip(), vm.group(2)
            elif ":" in body[:60]:
                speaker, text = body.split(":", 1)
            else:
                speaker, text = "Unknown", body
            text = _clean(text)
            if text:
                segments.append(Segment(start, end, _clean(speaker) or "Unknown", text))
            break
    return _merge(segments)


def _parse_plain(raw: str) -> list[Segment]:
    segments: list[Segment] = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = _PLAIN.match(line)
        if m:
            segments.append(Segment(to_seconds(m.group(1)), to_seconds(m.group(1)), _clean(m.group(2)),
                                    _clean(m.group(3))))
        elif segments:
            segments[-1].text += " " + _clean(line)
    for i, s in enumerate(segments):
        nxt = segments[i + 1].start if i + 1 < len(segments) else s.start + max(5, len(s.text) // 12)
        s.end = max(s.start, nxt - 1)
    return segments


def _merge(segments: list[Segment]) -> list[Segment]:
    """Teams emits many short cues; merge consecutive cues from the same speaker within a few seconds."""
    out: list[Segment] = []
    for s in segments:
        if out and out[-1].speaker == s.speaker and s.start - out[-1].end <= 2 and len(out[-1].text) < 400:
            out[-1].text += " " + s.text
            out[-1].end = s.end
        else:
            out.append(s)
    return out
