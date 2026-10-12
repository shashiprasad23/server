"""Pure domain-rule tests (F3 unit layer): duration math, transcript parsing, AI grounding, date parsing."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.core.timeutil import format_minutes, parse_duration, week_start
from app.modules.meetings import ai
from app.modules.meetings.transcript import parse_transcript, to_seconds


@pytest.mark.parametrize("raw,minutes", [
    ("1h 30m", 90), ("90m", 90), ("1.5h", 90), ("1:30", 90), ("2h", 120), ("45", 45), (75, 75), ("0h 15m", 15),
])
def test_parse_duration(raw, minutes):
    assert parse_duration(raw) == minutes


@pytest.mark.parametrize("raw", ["", "abc", "1x", "h"])
def test_parse_duration_rejects_garbage(raw):
    with pytest.raises(ValueError):
        parse_duration(raw)


def test_format_minutes():
    assert format_minutes(585) == "9h 45m"
    assert format_minutes(-285) == "-4h 45m"
    assert format_minutes(None) == "—"


def test_week_start_is_monday():
    assert week_start(date(2026, 10, 11)) == date(2026, 10, 5)
    assert week_start(date(2026, 10, 12)) == date(2026, 10, 12)


def test_parse_plain_transcript():
    segs = parse_transcript("00:12:41 R. Iyer: Hello there.\n00:14:22 A. Rao: I'll do it.\ncontinued line\n")
    assert [(s.start, s.speaker) for s in segs] == [(761, "R. Iyer"), (862, "A. Rao")]
    assert segs[1].text == "I'll do it. continued line"


def test_parse_vtt_transcript_strips_markup_and_merges():
    vtt = """WEBVTT

00:00:01.000 --> 00:00:03.000
<v M. Shah>Someone needs to <b>check</b></v>

00:00:03.500 --> 00:00:05.000
<v M. Shah>with Finance.</v>

00:00:09.000 --> 00:00:10.000
<v A. Rao>Agreed.</v>
"""
    segs = parse_transcript(vtt)
    assert len(segs) == 2
    assert segs[0].speaker == "M. Shah" and segs[0].text == "Someone needs to check with Finance."
    assert "<b>" not in segs[0].text
    assert to_seconds("01:02:03") == 3723


def _ctx(lines, attendees=None, tickets=None, d=date(2026, 10, 6)):
    segs = [ai.SegmentIn(i, i * 10, sp, tx) for i, (sp, tx) in enumerate(lines)]
    return ai.MeetingContext("M", d, "WP", segs, attendees or [sp for sp, _ in lines], tickets or [])


def test_due_date_parsing_relative_to_meeting():
    tue = date(2026, 10, 6)
    assert ai.parse_due_date("I'll do it before Friday", tue) == date(2026, 10, 9)
    assert ai.parse_due_date("by tomorrow", tue) == date(2026, 10, 7)
    assert ai.parse_due_date("by Tuesday", tue) == date(2026, 10, 13)  # same weekday means next week
    assert ai.parse_due_date("If 1042 isn't done by Monday, let's push", tue) is None  # condition, not a deadline
    assert ai.parse_due_date("no date here", tue) is None


def test_heuristic_does_not_invent_owner_or_due_date():
    ctx = _ctx([("M. Shah", "Someone needs to check with Finance how JPY and KWD should round.")])
    result = ai.ground(ai.HeuristicProvider().analyze(ctx).analysis, ctx)
    assert len(result.action_items) == 1
    action = result.action_items[0]
    assert action.owner_name is None and action.due_date is None
    assert action.evidence is not None and action.evidence.segment == 0


def test_first_person_commitment_owner_and_date():
    ctx = _ctx([("A. Rao", "I'll add the CVV length check on the server side before Friday.")])
    a = ai.ground(ai.HeuristicProvider().analyze(ctx).analysis, ctx).action_items[0]
    assert a.owner_name == "A. Rao" and a.due_date == date(2026, 10, 9) and a.confidence >= 0.8
    assert a.title == "Add the CVV length check on the server side"


def test_grounding_drops_fabricated_values_from_any_provider():
    ctx = _ctx([("A. Rao", "We should tidy the build scripts.")], tickets=[{"key": "WP-1", "title": "x", "status": "todo"}])
    analysis = ai.MeetingAnalysis(executive_summary="s", action_items=[
        ai.ActionItem(title="Tidy build scripts", owner_name="Somebody Else", due_date=date(2026, 10, 9),
                      confidence=0.9, evidence=ai.Evidence(segment=0, quote="We should tidy the build scripts.")),
        ai.ActionItem(title="Ghost", confidence=0.9, evidence=ai.Evidence(segment=42)),
        ai.ActionItem(title="Update unknown", kind="update", target_key="ZZ-9", confidence=0.9),
    ])
    out = ai.ground(analysis, ctx)
    assert out.action_items[0].owner_name is None  # not an attendee
    assert out.action_items[0].due_date is None  # not stated in evidence
    assert out.action_items[1].evidence is None and out.action_items[1].confidence <= 0.3
    assert len(out.action_items) == 2  # update against unknown ticket dropped


def test_speculative_statement_is_low_confidence():
    ctx = _ctx([("T. Becker", "Maybe at some point we could load test checkout.")])
    a = ai.HeuristicProvider().analyze(ctx).analysis.action_items[0]
    assert a.confidence < 0.5


def test_malformed_model_output_is_rejected():
    with pytest.raises(ValidationError):
        ai.MeetingAnalysis.model_validate({"executive_summary": "x", "action_items": [{"title": "", "confidence": 3}]})
