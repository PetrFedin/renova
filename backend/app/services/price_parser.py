"""Truthful, SSRF-safe extraction of supplier prices from public product pages."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from html import unescape
import ipaddress
import json
import re
import socket
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

MAX_RESPONSE_BYTES = 512_000
MAX_REDIRECTS = 3
REQUEST_TIMEOUT_SECONDS = 8.0
_ALLOWED_SCHEMES = {"http", "https"}
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_ALLOWED_CONTENT_TYPES = (
    "text/html",
    "application/xhtml+xml",
    "application/json",
    "application/ld+json",
)
_FORBIDDEN_HOST_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
    ".lan",
    ".home",
)
_FORBIDDEN_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "metadata.google.com",
}
_SHOP_DOMAINS = {
    "lemanapro.ru": "lemanapro",
    "leroymerlin.ru": "leroymerlin",
    "petrovich.ru": "petrovich",
    "obi.ru": "obi",
}

_JSON_LD_RE = re.compile(
    r"<script\b[^>]*type\s*=\s*['\"]application/ld\+json['\"][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
_META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_ATTR_RE = re.compile(
    r"([:\w-]+)\s*=\s*(?:['\"]([^'\"]*)['\"]|([^\s>]+))",
    re.IGNORECASE,
)
_CURRENCY_PRICE_RE = re.compile(
    r"(?<!\d)(\d{1,3}(?:[\s\u00a0\u202f.,]\d{3})*(?:[.,]\d{1,2})?|\d{1,8}(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:\.|ля|лей)?|RUB)\b?",
    re.IGNORECASE,
)


class PriceFetchError(ValueError):
    """A caller-visible, non-sensitive price-fetch failure."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class PriceFetchResult:
    price: float
    shop: str
    source: str
    final_url: str | None = None

    @property
    def verified_live(self) -> bool:
        return self.source.startswith("live_")


def _public_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_global


def _normalize_url(raw_url: str) -> tuple[str, str, int]:
    value = (raw_url or "").strip()
    if not value or value != raw_url or any(ord(char) < 32 for char in value):
        raise PriceFetchError("price_url_invalid")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as error:
        raise PriceFetchError("price_url_invalid") from error
    scheme = parts.scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise PriceFetchError("price_url_scheme_forbidden")
    if parts.username is not None or parts.password is not None:
        raise PriceFetchError("price_url_credentials_forbidden")
    hostname = (parts.hostname or "").rstrip(".").lower()
    if not hostname:
        raise PriceFetchError("price_url_invalid")
    if hostname in _FORBIDDEN_HOSTS or hostname.endswith(_FORBIDDEN_HOST_SUFFIXES):
        raise PriceFetchError("price_url_private_target")
    expected_port = 443 if scheme == "https" else 80
    if port is not None and port != expected_port:
        raise PriceFetchError("price_url_port_forbidden")
    normalized_netloc = hostname
    if ":" in hostname and not hostname.startswith("["):
        normalized_netloc = f"[{hostname}]"
    normalized = urlunsplit((scheme, normalized_netloc, parts.path or "/", parts.query, ""))
    return normalized, hostname, expected_port


async def _resolve_addresses(hostname: str, port: int) -> tuple[str, ...]:
    def resolve() -> tuple[str, ...]:
        infos = socket.getaddrinfo(
            hostname,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
        return tuple(sorted({str(info[4][0]) for info in infos}))

    try:
        return await asyncio.to_thread(resolve)
    except OSError as error:
        raise PriceFetchError("price_url_unresolvable") from error


async def validate_public_url(raw_url: str) -> str:
    """Normalize a URL and reject every non-public DNS/IP destination."""
    normalized, hostname, port = _normalize_url(raw_url)
    literal: str | None = None
    try:
        literal = str(ipaddress.ip_address(hostname.split("%", 1)[0]))
    except ValueError:
        pass
    addresses = (literal,) if literal else await _resolve_addresses(hostname, port)
    if not addresses or any(not _public_ip(address) for address in addresses):
        raise PriceFetchError("price_url_private_target")
    return normalized


def _shop_for_url(url: str) -> str:
    hostname = (urlsplit(url).hostname or "").rstrip(".").lower()
    for domain, shop in _SHOP_DOMAINS.items():
        if hostname == domain or hostname.endswith(f".{domain}"):
            return shop
    return "generic"


def _parse_price(raw: Any) -> float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
    else:
        text = unescape(str(raw)).strip()
        text = re.sub(r"[\s\u00a0\u202f]", "", text)
        if not text:
            return None
        comma = text.rfind(",")
        dot = text.rfind(".")
        if comma >= 0 and dot >= 0:
            decimal = "," if comma > dot else "."
            grouping = "." if decimal == "," else ","
            text = text.replace(grouping, "")
            text = text.replace(decimal, ".")
        elif comma >= 0:
            tail = len(text) - comma - 1
            text = text.replace(",", "." if tail in {1, 2} else "")
        elif dot >= 0:
            tail = len(text) - dot - 1
            if tail not in {1, 2}:
                text = text.replace(".", "")
        text = re.sub(r"[^0-9.]", "", text)
        try:
            value = float(text)
        except ValueError:
            return None
    if not (0 < value <= 10_000_000):
        return None
    return round(value, 2)


def _json_offer_prices(node: Any) -> list[float]:
    prices: list[float] = []
    if isinstance(node, list):
        for item in node:
            prices.extend(_json_offer_prices(item))
        return prices
    if not isinstance(node, dict):
        return prices

    offers = node.get("offers")
    if offers is not None:
        offer_nodes = offers if isinstance(offers, list) else [offers]
        for offer in offer_nodes:
            if not isinstance(offer, dict):
                continue
            currency = str(offer.get("priceCurrency") or "RUB").upper()
            if currency not in {"RUB", "RUR", "₽"}:
                continue
            for key in ("price", "lowPrice"):
                parsed = _parse_price(offer.get(key))
                if parsed is not None:
                    prices.append(parsed)
                    break
    for value in node.values():
        if value is not offers:
            prices.extend(_json_offer_prices(value))
    return prices


def _extract_json_ld_price(text: str) -> float | None:
    for match in _JSON_LD_RE.finditer(text):
        payload = unescape(match.group(1)).strip()
        try:
            parsed = json.loads(payload)
        except (TypeError, ValueError):
            continue
        prices = _json_offer_prices(parsed)
        if prices:
            return prices[0]
    return None


def _extract_meta_price(text: str) -> float | None:
    accepted = {
        "price",
        "product:price:amount",
        "og:price:amount",
        "twitter:data1",
    }
    for tag in _META_TAG_RE.findall(text):
        attrs = {
            key.lower(): unescape(quoted if quoted != "" else bare)
            for key, quoted, bare in _ATTR_RE.findall(tag)
        }
        marker = (
            attrs.get("itemprop")
            or attrs.get("property")
            or attrs.get("name")
            or ""
        ).lower()
        if marker not in accepted:
            continue
        parsed = _parse_price(attrs.get("content"))
        if parsed is not None:
            return parsed
    return None


def extract_price(text: str) -> tuple[float | None, str]:
    """Prefer structured product evidence; use currency-marked text only as fallback."""
    structured = _extract_json_ld_price(text)
    if structured is not None:
        return structured, "live_jsonld"
    meta = _extract_meta_price(text)
    if meta is not None:
        return meta, "live_meta"
    for match in _CURRENCY_PRICE_RE.finditer(text):
        parsed = _parse_price(match.group(1))
        if parsed is not None:
            return parsed, "live_currency"
    return None, "unavailable"


def _validate_peer(response: httpx.Response) -> None:
    """Best-effort post-connect guard against DNS rebinding."""
    stream = response.extensions.get("network_stream")
    if stream is None or not hasattr(stream, "get_extra_info"):
        return
    try:
        peer = stream.get_extra_info("server_addr")
    except Exception:
        return
    if isinstance(peer, (tuple, list)) and peer:
        peer = peer[0]
    if peer is not None and not _public_ip(str(peer)):
        raise PriceFetchError("price_url_private_target")


async def fetch_price(url: str, current: float = 0) -> PriceFetchResult:
    """Fetch one public page; never fabricate or silently replace a known price."""
    current_price = round(float(current or 0), 2)
    current_url = await validate_public_url(url)
    shop = _shop_for_url(current_url)
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)
    headers = {
        "User-Agent": "RenovaPriceVerifier/2.0",
        "Accept": "text/html,application/xhtml+xml,application/ld+json,application/json;q=0.9",
    }

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            for redirect_count in range(MAX_REDIRECTS + 1):
                async with client.stream("GET", current_url, headers=headers) as response:
                    _validate_peer(response)
                    if response.status_code in _REDIRECT_STATUSES:
                        location = response.headers.get("location")
                        if not location:
                            return PriceFetchResult(current_price, shop, "unavailable", current_url)
                        if redirect_count >= MAX_REDIRECTS:
                            raise PriceFetchError("price_redirect_limit")
                        current_url = await validate_public_url(urljoin(current_url, location))
                        shop = _shop_for_url(current_url)
                        continue
                    if response.status_code != 200:
                        return PriceFetchResult(current_price, shop, "unavailable", current_url)

                    content_type = response.headers.get("content-type", "").lower()
                    if content_type and not any(
                        allowed in content_type for allowed in _ALLOWED_CONTENT_TYPES
                    ):
                        return PriceFetchResult(current_price, shop, "unavailable", current_url)
                    content_length = response.headers.get("content-length")
                    if content_length:
                        try:
                            if int(content_length) > MAX_RESPONSE_BYTES:
                                raise PriceFetchError("price_response_too_large")
                        except ValueError:
                            pass

                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_RESPONSE_BYTES:
                            raise PriceFetchError("price_response_too_large")
                    encoding = response.encoding or "utf-8"
                    try:
                        text = bytes(body).decode(encoding, errors="replace")
                    except LookupError:
                        text = bytes(body).decode("utf-8", errors="replace")
                    price, source = extract_price(text)
                    if price is None:
                        return PriceFetchResult(current_price, shop, "unavailable", current_url)
                    return PriceFetchResult(price, shop, source, current_url)
    except PriceFetchError:
        raise
    except (httpx.HTTPError, OSError):
        return PriceFetchResult(current_price, shop, "unavailable", current_url)

    return PriceFetchResult(current_price, shop, "unavailable", current_url)
