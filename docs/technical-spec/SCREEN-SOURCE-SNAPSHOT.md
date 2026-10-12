# Renova screen contract — source snapshot

**Назначение:** машинно-проверяемый индекс implementation blobs для `SCREEN-CONTRACT-CATALOG.md`. Он отделён от длинного screen dossier, чтобы обновление traceability не требовало переписывать большой Markdown-файл целиком.

| Source | Git blob SHA | Contract area |
|---|---|---|
| `apps/mobile/components/renova/PrimaryButton.tsx` | `36a04974f20a8218e56c11cf11d5014fa7c2cb04` | shared CTA variants/sizes/states |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `b339134cc81941f15b1a363e6872acef0673f9dc` | Object hub |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `55ecda475da110a384bc2837136f0ccf0c7716e6` | Repair hub |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `789631cf5d74f657a318baed176b98aada208c26` | Budget hub |
| `apps/mobile/components/screens/OsMaterialsScreen.tsx` | `310f8c9dc20c9580baa2772a7397062fb0456d1b` | Materials/procurement hub + supply-aware next action |
| `apps/mobile/components/renova/MaterialPickList.tsx` | `ae24469347576b0675b683545017960711198ad2` | material supply editor + approval + truthful supplier-price refresh UX; durable price provenance is governed by `MATERIAL-PRICE-TRUTH-CONTRACT.md` |
| `apps/mobile/components/screens/OsSelectionsScreen.tsx` | `8a52566cfd463083b5055318871cc9668f1edf39` | Selections |
| `apps/mobile/components/screens/OsControlScreen.tsx` | `299b29fe2571900663e290c35bc0096854b8eb7f` | role/access-mode control router |
| `apps/mobile/components/screens/control/CustomerControlView.tsx` | `3abb468ac9f0a7719fec63fec80a3905eac1ea23` | customer acceptance/QC/warranty; exact issue/acceptance target, missing target state and selectors (Draft browser admission) |
| `apps/mobile/components/screens/control/ContractorControlView.tsx` | `dde1793c29fa45d27dacd8b98fafdd2abc693707` | contractor acceptance/QC; focused issue and missing target state |
| `apps/mobile/components/screens/control/TechnicalSupervisionControlView.tsx` | `14dbc179c069a9ef4bfa7ae61d1cad5843842a38` | technical-supervision QC; focused issue and missing target state |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `b04ac08459926439b0533db3decce28a4791843c` | hub tab geometry/progressive disclosure |

При изменении любого source выше `technicalSpecAnnexContract.test.mjs` должен потребовать обновить соответствующий screen contract и этот snapshot. SHA является traceability marker, а не самостоятельным доказательством корректности UX.
