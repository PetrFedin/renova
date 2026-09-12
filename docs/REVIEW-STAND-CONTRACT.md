# RENOVA review stand contract

The review stand is intentionally different from staging/production. It exists to expose the current product surface with canonical test data without enabling live providers.

Required behavior:

1. Root URL opens `onboarding/role`.
2. Demo mode is explicitly enabled via `EXPO_PUBLIC_DEMO=1`.
3. The user chooses `Заказчик` or `Исполнитель`; iframe preview must not auto-login.
4. Review mode skips the detail quiz only after demo role selection and opens the project picker.
5. A pristine canonical test seed exposes the complete demo project set, including `Демо-квартира` and `Демо-дом`.
6. Existing seeded domain surfaces remain available for inspection: rooms/floors, stages and acceptance, finance/payment evidence, procurement, project chats/tasks, contractor profile and guest read-only access.
7. Real payments, SMS, provider credentials and production evidence remain out of scope for this stand.

This contract must never weaken staging/production fail-closed policies.
