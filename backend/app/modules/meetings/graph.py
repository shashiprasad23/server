"""Microsoft Graph adapter for Teams meeting transcripts (C9).

Uses application permissions (client credentials) with least privilege: OnlineMeetingTranscript.Read.All,
restricted by an application access policy to permitted organizers. Disabled unless configured.
"""

import time

import httpx

from app.config import get_settings
from app.core.errors import ServiceUnavailable

GRAPH = "https://graph.microsoft.com/v1.0"


class GraphClient:
    def __init__(self):
        s = get_settings()
        if not (s.graph_tenant_id and s.graph_client_id and s.graph_client_secret):
            raise ServiceUnavailable(
                "Teams integration is not configured. Ask an administrator to grant tenant consent, "
                "or upload the transcript file instead.", code="teams_not_configured")
        self._s = s
        self._token: str | None = None
        self._exp = 0.0

    def _auth(self) -> str:
        if self._token and time.time() < self._exp - 60:
            return self._token
        r = httpx.post(f"https://login.microsoftonline.com/{self._s.graph_tenant_id}/oauth2/v2.0/token", data={
            "client_id": self._s.graph_client_id, "client_secret": self._s.graph_client_secret,
            "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"}, timeout=20)
        if r.status_code != 200:
            raise ServiceUnavailable("Could not authenticate to Microsoft Graph", code="graph_auth_failed")
        body = r.json()
        self._token, self._exp = body["access_token"], time.time() + int(body.get("expires_in", 3600))
        return self._token

    def _get(self, url: str, accept: str = "application/json") -> httpx.Response:
        for attempt in range(4):
            r = httpx.get(url, headers={"Authorization": f"Bearer {self._auth()}", "Accept": accept}, timeout=30)
            if r.status_code in (429, 503, 504):
                # Throttling-aware retry with backoff (honours Retry-After).
                time.sleep(float(r.headers.get("Retry-After", 2 ** attempt)))
                continue
            if r.status_code in (401, 403, 404):
                raise ServiceUnavailable(
                    "The meeting or its transcript is not accessible with the granted permissions",
                    code="graph_forbidden")
            r.raise_for_status()
            return r
        raise ServiceUnavailable("Microsoft Graph is throttling requests; try again later", code="graph_throttled")

    def fetch_transcript_vtt(self, organizer_id: str, meeting_id: str) -> tuple[dict, str]:
        meeting = self._get(f"{GRAPH}/users/{organizer_id}/onlineMeetings/{meeting_id}").json()
        transcripts = self._get(f"{GRAPH}/users/{organizer_id}/onlineMeetings/{meeting_id}/transcripts").json()
        items = transcripts.get("value") or []
        if not items:
            raise ServiceUnavailable("No transcript is available for this meeting yet", code="transcript_missing")
        tid = items[-1]["id"]
        vtt = self._get(f"{GRAPH}/users/{organizer_id}/onlineMeetings/{meeting_id}/transcripts/{tid}/content"
                        "?$format=text/vtt", accept="text/vtt").text
        return meeting, vtt
