from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from . import ACCOUNT_PARSER_VERSION

MAX_FILE_BYTES = 2_000_000
MAX_MESSAGES = 500
MAX_MESSAGE_CHARS = 20_000

_WS = re.compile(r"\s+")
_BROKER_AT_START = re.compile(r"^\s*([A-Za-z]{1,8}\d{2,15})\b")
_BROKER_LABELLED = re.compile(
    r"\b(?:broker|tms)(?:\s*(?:id|code|no))?\s*[:#-]?\s*([A-Za-z0-9]{4,20})\b",
    re.IGNORECASE,
)
_SIDE = re.compile(r"\b(?:you\s+)?(bought|sold|purchased)\b", re.IGNORECASE)
_SIDE_EXPLICIT = re.compile(r"\b(BUY|SELL)\b", re.IGNORECASE)
_ISO_DATE = re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b")
_LOCAL_DATE = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b")
_BAMT = re.compile(
    r"\bB\s*Amt\b\s*[:.]?\s*(?:NPR|Rs\.?|रू)?\s*([\d,]+(?:\.\d+)?)",
    re.IGNORECASE,
)
_BILL_NO = re.compile(
    r"\b(?:BNo|Bill\s*(?:No|Number))\s*\.?\s*[:#-]?\s*([A-Za-z0-9/_-]+)",
    re.IGNORECASE,
)
_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_WWW = re.compile(r"\bwww\.[^\s<>\"']+", re.IGNORECASE)
_SECURITY_LINE = re.compile(
    r"(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,24}?)\s*(?:-\s*|\s+)(\d+(?:\.\d+)?)\s*@\s*(\d+(?:\.\d+)?)"
)


def normalize_text(text: str) -> str:
    text = (
        text.replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\ufeff", "")
    )
    text = re.sub(r"[\u2010-\u2015\u2212]", "-", text)
    text = re.sub(r"[\r\n\t]+", " ", text)
    return _WS.sub(" ", text).strip()


def fingerprint(text: str) -> str:
    return hashlib.sha256(normalize_text(text).casefold().encode("utf-8")).hexdigest()


def _money(value: str) -> Decimal:
    try:
        return Decimal(value.replace(",", "")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    except (InvalidOperation, AttributeError) as exc:
        raise ValueError(f"Invalid amount: {value!r}") from exc


def _quantity(value: str) -> Decimal:
    try:
        out = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid quantity: {value!r}") from exc
    if out <= 0:
        raise ValueError(f"Quantity must be greater than zero: {value!r}")
    return out


def _price(value: str) -> Decimal:
    try:
        out = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid price: {value!r}") from exc
    if out <= 0:
        raise ValueError(f"Price must be greater than zero: {value!r}")
    return out


def _parse_date(normalized: str) -> tuple[date | None, list[str], list[str]]:
    warnings: list[str] = []
    errors: list[str] = []
    match = _ISO_DATE.search(normalized)
    if match:
        year, month, day = (int(part) for part in match.groups())
        try:
            return date(year, month, day), warnings, errors
        except ValueError:
            errors.append(f"Invalid transaction date: {match.group(0)}")
            return None, warnings, errors

    match = _LOCAL_DATE.search(normalized)
    if match:
        first, second, third = (int(part) for part in match.groups())
        year = third + (2000 if third < 100 else 0)
        # Prefer day/month/year only when it is unambiguous; the broker SMS
        # examples use ISO dates, and guessing can silently mis-date a trade.
        if first > 12 and second <= 12:
            try:
                warnings.append("DATE_INTERPRETED_DD_MM_YYYY")
                return date(year, second, first), warnings, errors
            except ValueError:
                pass
        errors.append("Transaction date is ambiguous; enter it manually.")
        return None, warnings, errors

    errors.append("Transaction date not found.")
    return None, warnings, errors


@dataclass
class ParsedLine:
    line_no: int
    symbol: str
    quantity: Decimal
    price: Decimal
    gross: Decimal
    raw: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "line_no": self.line_no,
            "symbol": self.symbol,
            "quantity": str(self.quantity),
            "price": str(self.price),
            "gross": f"{self.gross:.2f}",
            "raw": self.raw,
        }


@dataclass
class ParsedMessage:
    raw_text: str
    normalized_text: str
    fingerprint: str
    broker_id: str | None = None
    trade_date: date | None = None
    side: str | None = None
    lines: list[ParsedLine] = field(default_factory=list)
    bamt: Decimal | None = None
    bill_no: str | None = None
    payment_url: str | None = None
    confidence: int = 0
    status: str = "ERROR"
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    parser_version: str = ACCOUNT_PARSER_VERSION

    @property
    def gross_total(self) -> Decimal:
        return sum((line.gross for line in self.lines), Decimal("0")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "normalized_text": self.normalized_text,
            "fingerprint": self.fingerprint,
            "broker_id": self.broker_id,
            "trade_date": self.trade_date.isoformat() if self.trade_date else None,
            "side": self.side,
            "lines": [line.as_dict() for line in self.lines],
            "gross_total": f"{self.gross_total:.2f}",
            "bamt": f"{self.bamt:.2f}" if self.bamt is not None else None,
            "bill_no": self.bill_no,
            "payment_url": self.payment_url,
            "confidence": self.confidence,
            "status": self.status,
            "warnings": self.warnings,
            "errors": self.errors,
            "parser_version": self.parser_version,
            "line_count": len(self.lines),
        }


@dataclass
class RawMessage:
    raw_text: str
    sender: str | None = None
    received_at: datetime | None = None
    filename: str | None = None
    source_type: str = "PASTE"


def parse_sms(raw_text: str) -> ParsedMessage:
    raw = (raw_text or "").strip()
    normalized = normalize_text(raw)
    parsed = ParsedMessage(
        raw_text=raw,
        normalized_text=normalized,
        fingerprint=fingerprint(raw),
        confidence=0,
    )
    if not normalized:
        parsed.errors.append("Message is empty.")
        parsed.status = "ERROR"
        return parsed

    broker = _BROKER_AT_START.search(normalized) or _BROKER_LABELLED.search(normalized)
    if broker:
        parsed.broker_id = broker.group(1).upper()
    else:
        parsed.warnings.append("MISSING_BROKER")

    side_match = _SIDE.search(normalized) or _SIDE_EXPLICIT.search(normalized)
    if side_match:
        token = side_match.group(1).lower()
        parsed.side = "BUY" if token in {"bought", "buy", "purchased"} else "SELL"
    else:
        parsed.errors.append("Transaction side (BUY or SELL) not found.")

    parsed.trade_date, date_warnings, date_errors = _parse_date(normalized)
    parsed.warnings.extend(date_warnings)
    parsed.errors.extend(date_errors)

    bamt_match = _BAMT.search(normalized)
    if bamt_match:
        try:
            parsed.bamt = _money(bamt_match.group(1))
        except ValueError as exc:
            parsed.errors.append(str(exc))
    elif parsed.side == "BUY":
        parsed.warnings.append("MISSING_BAMT")

    bill_match = _BILL_NO.search(normalized)
    if bill_match:
        parsed.bill_no = bill_match.group(1).strip(".,;")
    else:
        parsed.warnings.append("MISSING_BILL_NO")

    url_match = _URL.search(normalized) or _WWW.search(normalized)
    if url_match:
        url = url_match.group(0).rstrip(".,);]")
        if url.lower().startswith("www."):
            url = f"https://{url}"
        if url.lower().startswith(("http://", "https://")):
            parsed.payment_url = url

    # Security lines live before the date/bill trailer in the broker formats.
    line_region = normalized
    iso = _ISO_DATE.search(line_region)
    if iso:
        line_region = line_region[: iso.start()]
    line_region = _URL.sub(" ", line_region)
    line_region = _WWW.sub(" ", line_region)
    line_region = _BAMT.sub(" ", line_region)
    line_region = _BILL_NO.sub(" ", line_region)

    for index, match in enumerate(_SECURITY_LINE.finditer(line_region)):
        symbol = match.group(1).upper()
        try:
            quantity = _quantity(match.group(2))
            price = _price(match.group(3))
        except ValueError as exc:
            parsed.errors.append(f"{symbol}: {exc}")
            continue
        gross = (quantity * price).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        parsed.lines.append(
            ParsedLine(
                line_no=index,
                symbol=symbol,
                quantity=quantity,
                price=price,
                gross=gross,
                raw=match.group(0),
            )
        )

    if not parsed.lines:
        parsed.errors.append("No security lines could be extracted.")
    if len(parsed.lines) > 1:
        parsed.warnings.append("MULTIPLE_SECURITIES")

    confidence = 100
    if not parsed.broker_id:
        confidence -= 15
    if not parsed.trade_date:
        confidence -= 35
    if not parsed.side:
        confidence -= 25
    if not parsed.lines:
        confidence -= 40
    if parsed.side == "BUY" and parsed.bamt is None:
        confidence -= 8
    if not parsed.bill_no:
        confidence -= 5
    parsed.confidence = max(0, min(100, confidence))

    if not parsed.lines:
        parsed.status = "ERROR"
    elif parsed.errors or not parsed.trade_date or not parsed.side:
        parsed.status = "NEEDS_REVIEW"
    else:
        parsed.status = "PARSED"
    return parsed


def apply_known_symbols(parsed: ParsedMessage, known: set[str]) -> ParsedMessage:
    if not known:
        return parsed
    unknown = [line.symbol for line in parsed.lines if line.symbol not in known]
    for symbol in dict.fromkeys(unknown):
        parsed.warnings.append(f"UNKNOWN_SYMBOL:{symbol}")
    if unknown:
        parsed.confidence = max(0, parsed.confidence - min(20, len(unknown) * 5))
    return parsed


def split_messages(text: str) -> list[str]:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    broker_start = re.compile(
        r"(?=^\s*[A-Za-z]{1,8}\d{2,15}\s*,?\s*(?:you\s+)?(?:bought|sold|purchased)\b)",
        re.IGNORECASE | re.MULTILINE,
    )
    for paragraph in paragraphs:
        parts = [p.strip() for p in broker_start.split(paragraph) if p.strip()]
        if len(parts) == 1:
            inline = re.split(
                r"(?=\s+[A-Za-z]{1,8}\d{2,15}\s*,?\s*(?:you\s+)?(?:bought|sold|purchased)\b)",
                paragraph,
                flags=re.IGNORECASE,
            )
            parts = [p.strip() for p in inline if p.strip()]
        chunks.extend(parts or [paragraph])
    # Keep order, drop exact duplicates.
    seen: set[str] = set()
    out: list[str] = []
    for chunk in chunks:
        key = fingerprint(chunk)
        if key not in seen:
            seen.add(key)
            out.append(chunk)
    return out[:MAX_MESSAGES]


def _csv_messages(content: str, filename: str | None) -> list[RawMessage]:
    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader) if reader.fieldnames else []
    if not rows:
        # No header: treat the first non-empty cell in each row as the message.
        plain = csv.reader(io.StringIO(content))
        out: list[RawMessage] = []
        for row in plain:
            body = next((cell.strip() for cell in row if cell and cell.strip()), "")
            if body:
                out.append(
                    RawMessage(body, filename=filename, source_type="CSV")
                )
        return out[:MAX_MESSAGES]

    headers = {h.strip().lower(): h for h in (reader.fieldnames or []) if h}
    body_key = next(
        (headers[k] for k in ("body", "message", "text", "sms", "content") if k in headers),
        None,
    )
    if body_key is None:
        raise ValueError("CSV must contain a body, message, text, sms, or content column.")
    sender_key = next(
        (headers[k] for k in ("address", "sender", "from", "phone") if k in headers),
        None,
    )
    date_key = next(
        (headers[k] for k in ("date", "received_at", "timestamp", "datetime") if k in headers),
        None,
    )
    out = []
    for row in rows:
        body = (row.get(body_key) or "").strip()
        if not body:
            continue
        received = None
        if date_key and row.get(date_key):
            received = _parse_exported_datetime(row[date_key])
        out.append(
            RawMessage(
                raw_text=body,
                sender=(row.get(sender_key) or None) if sender_key else None,
                received_at=received,
                filename=filename,
                source_type="CSV",
            )
        )
    return out[:MAX_MESSAGES]


def _parse_exported_datetime(value: str) -> datetime | None:
    value = str(value).strip()
    if not value:
        return None
    try:
        numeric = float(value)
        # Android SMS backups use milliseconds since the Unix epoch.
        if numeric > 10_000_000_000:
            numeric /= 1000
        return datetime.fromtimestamp(numeric, tz=UTC).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError):
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value[:19], fmt)
        except ValueError:
            continue
    return None


def _xml_messages(content: str, filename: str | None) -> list[RawMessage]:
    # ElementTree does not resolve external entities by default.  Reject a
    # document with a DTD instead of accepting an XXE-capable payload.
    if "<!DOCTYPE" in content.upper() or "<!ENTITY" in content.upper():
        raise ValueError("XML documents with DTD/entity declarations are not accepted.")
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc
    out: list[RawMessage] = []
    for element in root.iter():
        body = element.attrib.get("body") or element.attrib.get("message")
        if not body:
            continue
        out.append(
            RawMessage(
                raw_text=body,
                sender=element.attrib.get("address") or element.attrib.get("sender"),
                received_at=_parse_exported_datetime(element.attrib.get("date", "")),
                filename=filename,
                source_type="XML",
            )
        )
    return out[:MAX_MESSAGES]


def _json_messages(content: str, filename: str | None) -> list[RawMessage]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc
    items = payload.get("messages") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise ValueError("JSON must be a list of messages or an object with a messages list.")
    out: list[RawMessage] = []
    for item in items:
        if isinstance(item, str):
            out.append(RawMessage(item, filename=filename, source_type="JSON"))
        elif isinstance(item, dict):
            body = item.get("body") or item.get("message") or item.get("text")
            if body:
                out.append(
                    RawMessage(
                        raw_text=str(body),
                        sender=item.get("sender") or item.get("address"),
                        received_at=_parse_exported_datetime(item.get("date", "")),
                        filename=filename,
                        source_type="JSON",
                    )
                )
    return out[:MAX_MESSAGES]


def enforce_message_limits(messages: list[RawMessage]) -> list[RawMessage]:
    """Keep batches bounded and reject a single oversized commit payload early."""
    messages = messages[:MAX_MESSAGES]
    for message in messages:
        if len(message.raw_text) > MAX_MESSAGE_CHARS:
            raise ValueError(
                f"A message is longer than {MAX_MESSAGE_CHARS:,} characters. "
                "Split it into smaller messages before importing."
            )
    return messages


def parse_file(filename: str | None, content: str) -> list[RawMessage]:
    if len(content.encode("utf-8")) > MAX_FILE_BYTES:
        raise ValueError("File is larger than 2 MB.")
    suffix = Path(filename or "").suffix.lower()
    if suffix == ".xml":
        messages = _xml_messages(content, filename)
    elif suffix == ".csv":
        messages = _csv_messages(content, filename)
    elif suffix == ".json":
        messages = _json_messages(content, filename)
    elif suffix in {"", ".txt", ".text", ".log", ".md"}:
        messages = [
            RawMessage(chunk, filename=filename, source_type="TXT")
            for chunk in split_messages(content)
        ]
    else:
        raise ValueError("Unsupported file type. Use .txt, .csv, .xml, or .json.")
    return enforce_message_limits(messages)
