"""Симулятор проверки фискальных чеков (порт FiscalReceiptProvider).

Детерминированный: исход выбирается по хвосту ФПД (fp) в QR-строке, чтобы
E2E/golden-path тесты могли получить любой сценарий без сети:

    fp заканчивается на 9999 → NOT_FOUND       (ФНС не нашла чек)
    fp заканчивается на 8888 → AMOUNT_MISMATCH (сумма в ФНС на 1 % больше)
    fp заканчивается на 7777 → UNAVAILABLE     (таймаут/5xx — можно повторить)
    иначе                     → VALID           (сумма совпадает)

Запрещён в staging/production политикой registry.
"""
from __future__ import annotations

from decimal import Decimal

from app.services.providers import base

PROVIDER_NAME = "simulated_fiscal_receipt"
SELLER_INN = "7700000000"
SELLER_NAME = "ООО «Стройматериалы Симулятор»"


class SimulatedFiscalReceiptProvider:
    name = PROVIDER_NAME
    mode = base.ProviderMode.SIMULATED

    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(name=self.name, mode=self.mode, available=True, detail="deterministic by fp suffix")

    async def verify(self, query: base.ReceiptQuery) -> base.ReceiptVerification:
        fp = str(query.fp or "")
        raw = {"provider": self.name, "fn": query.fn, "fd": query.fd, "fp": query.fp}
        if fp.endswith("9999"):
            return base.ReceiptVerification(verdict=base.ReceiptVerdict.NOT_FOUND, raw=raw)
        if fp.endswith("7777"):
            return base.ReceiptVerification(verdict=base.ReceiptVerdict.UNAVAILABLE, raw=raw)
        amount = query.money.amount
        if fp.endswith("8888"):
            amount = (amount * Decimal("1.01")).quantize(Decimal("0.01"))
            return base.ReceiptVerification(
                verdict=base.ReceiptVerdict.AMOUNT_MISMATCH,
                provider_amount=base.Money(amount, query.money.currency),
                seller_inn=SELLER_INN,
                seller_name=SELLER_NAME,
                raw={**raw, "totalSum": int(amount * 100)},
            )
        return base.ReceiptVerification(
            verdict=base.ReceiptVerdict.VALID,
            provider_amount=base.Money(amount, query.money.currency),
            seller_inn=SELLER_INN,
            seller_name=SELLER_NAME,
            items=[{"name": "Материалы (симулятор)", "sum": int(amount * 100)}],
            raw={**raw, "totalSum": int(amount * 100)},
        )
