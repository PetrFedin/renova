# Renova screen contract — source snapshot

**Назначение:** машинно-проверяемый индекс implementation blobs для `SCREEN-CONTRACT-CATALOG.md`. Он отделён от длинного screen dossier, чтобы обновление traceability не требовало переписывать большой Markdown-файл целиком.

| Source | Git blob SHA | Contract area |
|---|---|---|
| `apps/mobile/components/renova/PrimaryButton.tsx` | `b1dab4b50ae2b5e078024e16a3b0c37120c996a1` | shared CTA variants/sizes/states |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305` | Repair hub |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub |
| `apps/mobile/components/screens/OsMaterialsScreen.tsx` | `5eb40edd4de8869aadcd71770669d813dd66e3c2` | Materials/procurement |
| `apps/mobile/components/screens/OsSelectionsScreen.tsx` | `9ccb7fa6b1df87d21372369de73b748f8c7779e1` | Selections |
| `apps/mobile/components/screens/OsControlScreen.tsx` | `b33fe8343d7629fd5ac859009ebdff36da629810` | role/access-mode control router |
| `apps/mobile/components/screens/control/CustomerControlView.tsx` | `da4faeed719c936af4daf0b7b7b6b69b7c16c0e9` | customer acceptance/QC/warranty view |
| `apps/mobile/components/screens/control/ContractorControlView.tsx` | `dc2d3793252be1668ffe720e98cf1572c7d9c085` | contractor acceptance/QC view |
| `apps/mobile/components/screens/control/TechnicalSupervisionControlView.tsx` | `3f9ca8a779a96f74f25cef885004301b423a681e` | technical-supervision control view |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `f480067b06c750623e4091fe0db128c877e3fb37` | hub tab geometry/progressive disclosure |

При изменении любого source выше `technicalSpecAnnexContract.test.mjs` должен потребовать обновить соответствующий screen contract и этот snapshot. SHA является traceability marker, а не самостоятельным доказательством корректности UX.
