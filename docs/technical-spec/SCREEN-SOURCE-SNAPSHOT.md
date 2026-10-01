# Renova screen contract — source snapshot

**Назначение:** машинно-проверяемый индекс implementation blobs для `SCREEN-CONTRACT-CATALOG.md`. Он отделён от длинного screen dossier, чтобы обновление traceability не требовало переписывать большой Markdown-файл целиком.

| Source | Git blob SHA | Contract area |
|---|---|---|
| `apps/mobile/components/renova/PrimaryButton.tsx` | `36a04974f20a8218e56c11cf11d5014fa7c2cb04` | shared CTA variants/sizes/states |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305` | Repair hub |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub |
| `apps/mobile/components/screens/OsMaterialsScreen.tsx` | `f39ac1fc3a6b06fa027b0e32d8cd55d2f8031b04` | Materials/procurement hub + supply-aware next action |
| `apps/mobile/components/renova/MaterialPickList.tsx` | `ab22a92c49fe72c20f81548ee0de39b32b046024` | material supply editor + approval + truthful supplier-price refresh UX; durable price provenance is governed by `MATERIAL-PRICE-TRUTH-CONTRACT.md` |
| `apps/mobile/components/screens/OsSelectionsScreen.tsx` | `928c6979f2a2a0d884d19210eb6980c690f331ac` | Selections |
| `apps/mobile/components/screens/OsControlScreen.tsx` | `299b29fe2571900663e290c35bc0096854b8eb7f` | role/access-mode control router |
| `apps/mobile/components/screens/control/CustomerControlView.tsx` | `3e7f4cdcfdb5ee9d52aee09db19659eb639caaf2` | customer acceptance/QC/warranty view |
| `apps/mobile/components/screens/control/ContractorControlView.tsx` | `907887032766d02be6df17bafd6894384b96b0c3` | contractor acceptance/QC view |
| `apps/mobile/components/screens/control/TechnicalSupervisionControlView.tsx` | `3f9ca8a779a96f74f25cef885004301b423a681e` | technical-supervision control view |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `b04ac08459926439b0533db3decce28a4791843c` | hub tab geometry/progressive disclosure |

При изменении любого source выше `technicalSpecAnnexContract.test.mjs` должен потребовать обновить соответствующий screen contract и этот snapshot. SHA является traceability marker, а не самостоятельным доказательством корректности UX.
