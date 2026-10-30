"""Strict schemas for the native-messaging trust boundary."""
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def web_url(value: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("Control characters are not allowed")
    u = urlsplit(value)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        raise ValueError("Only HTTP and HTTPS media addresses are supported")
    return value


class Source(StrictModel):
    url: str = Field(max_length=16384)
    kind: Literal["page", "manifest", "file"]
    entryIndex: int | None = Field(default=None, ge=1, le=100)
    headers: dict[str, str] = Field(default_factory=dict, max_length=8)

    _url = field_validator("url")(web_url)

    @field_validator("headers")
    @classmethod
    def safe_headers(cls, headers):
        allowed = {"user-agent": "User-Agent", "referer": "Referer", "origin": "Origin", "accept": "Accept"}
        result = {}
        for key, value in headers.items():
            if key.lower() not in allowed or len(value) > 4096 or any(ord(c) < 32 for c in value):
                raise ValueError("Unsupported media header")
            result[allowed[key.lower()]] = value
        return result


class Cookie(StrictModel):
    name: str = Field(max_length=1024)
    value: str = Field(max_length=16384)
    domain: str = Field(max_length=253, pattern=r"^\.?[a-zA-Z0-9_.:-]+$")
    path: str = Field(max_length=2048)
    secure: bool
    httpOnly: bool
    hostOnly: bool
    expirationDate: float | int | None = None

    @field_validator("name", "value", "path")
    @classmethod
    def no_controls(cls, value):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Invalid cookie")
        return value


class Request(StrictModel):
    id: str = Field(max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")


class Ping(Request):
    type: Literal["ping"]


class Start(Request):
    type: Literal["start"]
    requestId: str
    title: str = Field(max_length=300, default="Video")
    sources: list[Source] = Field(min_length=1, max_length=16)
    cookies: list[Cookie] = Field(default_factory=list, max_length=500)
    browserDownload: bool = False
    assetType: Literal["video", "image"] = "video"
    imageData: str | None = Field(default=None, max_length=700000)

    @model_validator(mode="after")
    def image_only_data(self):
        if self.imageData and self.assetType != "image": raise ValueError("Image data is only valid for an image")
        return self

    @field_validator("requestId")
    @classmethod
    def uuid_request(cls, value):
        UUID(value)
        return value

    @field_validator("cookies")
    @classmethod
    def bounded_cookie_bytes(cls, cookies):
        if sum(len(c.name) + len(c.value) for c in cookies) > 256 * 1024:
            raise ValueError("Too many cookies")
        return cookies


class Jobs(Request):
    type: Literal["jobs"]


class JobAction(Request):
    type: Literal["cancel", "reveal", "prepare"]
    jobId: str = Field(pattern=r"^[0-9a-f]{32}$")


class Clear(Request):
    type: Literal["clear"]


class Finish(Request):
    type: Literal["finish"]
    jobId: str = Field(pattern=r"^[0-9a-f]{32}$")
    path: str = Field(max_length=4096, min_length=1)

    @field_validator("path")
    @classmethod
    def safe_path(cls, value):
        if any(ord(c) < 32 for c in value): raise ValueError("Invalid path")
        return value


class CleanImage(Request):
    type: Literal["clean-image"]
    requestId: str
    path: str = Field(min_length=1, max_length=4096)

    _uuid = field_validator("requestId")(Start.uuid_request.__func__)
    _path = field_validator("path")(Finish.safe_path.__func__)


RequestAdapter = TypeAdapter(Annotated[Ping | Start | Jobs | JobAction | Clear | Finish | CleanImage, Field(discriminator="type")])
