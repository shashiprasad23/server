"""Object storage behind an adapter. Local filesystem in development; swap for Azure Blob in production."""

import hashlib
import os
import uuid
from pathlib import Path


class LocalStorage:
    def __init__(self, root: str | None = None):
        self.root = Path(root or os.environ.get("UPM_STORAGE_DIR", "./storage")).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, data: bytes, prefix: str, suffix: str = "") -> tuple[str, str]:
        ref = f"{prefix}/{uuid.uuid4().hex}{suffix}"
        path = self.root / ref
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return ref, hashlib.sha256(data).hexdigest()

    def path(self, ref: str) -> Path:
        p = (self.root / ref).resolve()
        if self.root not in p.parents:
            raise ValueError("Invalid storage reference")
        return p

    def delete(self, ref: str) -> None:
        p = self.path(ref)
        if p.exists():
            p.unlink()


storage = LocalStorage()
