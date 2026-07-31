"""Fetch verifiable product prices without fabricated fallbacks."""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse


SHOP_HOSTS = {
    "lemanapro.ru": "lemanapro",
    "leroymerlin.ru": "leroymerlin",
    "petrovich.ru": "petrovich",
    "obi.ru": "obi",
}

_STRUCTURED_PRICE_PATTERNS = (
    re.compile(r'"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?', re.I),
    re.compile(
        r'itemprop=["\']price["\'][^>]{0,300}?content=["\'](\d+(?:[.,]\d{1,2})?)["\']',
        re.I,
    ),
    re.compile(
        r'content=["\'](\d+(?:[.,]\d{1,2})?)["\'][^>]{0,300}?itemprop=["\']price["\']',
        re.I,
    ),
    re.compile(r'data-price=["\'](\d+(?:[.,]\d{1,2})?)["\']', re.I),
)
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 3


class PriceUnavailable(RuntimeError):
    """A live price could not be verified; callers must preserve existing truth."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _shop_for_url(url: str) -> str:
    hostname = (urlparse(url).hostname or "").rstrip(".").lower()
    for domain, canonical in SHOP_HOSTS.items():
        if hostname == domain or hostname.endswith(f".{domain}"):
            return canonical
    return "generic"


def _is_public_ip(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


async def _validate_public_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PriceUnavailable("invalid_price_url")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        raise PriceUnavailable("private_price_url")

    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public_ip(str(literal)):
            raise PriceUnavailable("private_price_url")
        return

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except OSError as error:
        raise PriceUnavailable("price_host_unresolvable") from error
    if not addresses:
        raise PriceUnavailable("price_host_unresolvable")
    for address in addresses:
        resolved_ip = address[4][0]
        if not _is_public_ip(resolved_ip):
            raise PriceUnavailable("private_price_url")


def _extract_structured_prices(html: str) -> list[float]:
    prices: list[float] = []
    for pattern in _STRUCTURED_PRICE_PATTERNS:
        for match in pattern.finditer(html[:500_000]):
            try:
                value = float(match.group(1).replace(",", "."))
            except (TypeError, ValueError):
                continue
            if 10 < value < 500_000:
                prices.append(round(value, 2))
    return prices


async def fetch_price(url: str, current: float = 0) -> tuple[float, str, str]:
    """Return a verified live price or raise without changing the current price.

    `current` is accepted for backward compatibility and is never used as a
    fabricated success fallback. Every redirect target is revalidated so a public
    product URL cannot redirect the server into a private network.
    """
    del current
    current_url = url

    try:
        import httpx
    except Exception as error:  # noqa: BLE001 - explicit dependency failure
        raise PriceUnavailable("price_client_unavailable") from error

    async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
        for redirect_count in range(_MAX_REDIRECTS + 1):
            await _validate_public_http_url(current_url)
            try:
                response = await client.get(
                    current_url,
                    headers={"User-Agent": "RenovaBot/1.0"},
                )
            except Exception as error:  # noqa: BLE001 - explicit domain failure
                raise PriceUnavailable("price_request_failed") from error

            if response.status_code not in _REDIRECT_STATUSES:
                break
            location = response.headers.get("location")
            if not location:
                raise PriceUnavailable("price_redirect_without_location")
            if redirect_count >= _MAX_REDIRECTS:
                raise PriceUnavailable("price_too_many_redirects")
            current_url = urljoin(current_url, location)
        else:  # pragma: no cover - loop always exits via break or explicit error
            raise PriceUnavailable("price_too_many_redirects")

    if response.status_code != 200:
        raise PriceUnavailable(f"price_http_{response.status_code}")
    prices = _extract_structured_prices(response.text)
    if not prices:
        raise PriceUnavailable("structured_price_not_found")

    # Structured product pages may repeat the same offer in JSON-LD and meta tags.
    # The first structured occurrence is preferable to arbitrary min/max selection.
    return prices[0], _shop_for_url(current_url), "live_structured"
