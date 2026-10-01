# Renova screen contract — source snapshot

**Назначение:** машинно-проверяемый индекс implementation blobs для `SCREEN-CONTRACT-CATALOG.md`. Он отделён от длинного screen dossier, чтобы обновление traceability не требовало переписывать большой Markdown-файл целиком.

| Source | Git blob SHA | Contract area |
|---|---|---|
| `apps/mobile/components/renova/PrimaryButton.tsx` | `36a04974f20a8218e56c11cf11d5014fa7c2cb04` | shared CTA variants/sizes/states |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `62060329592176b8d42591b92fe197aaa52e59d7` | Repair hub |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub |
| `apps/mobile/components/screens/OsMaterialsScreen.tsx` | `ecd2bfed4ee90389987d3833eb30379ae9400fab` | Materials/procurement hub + supply-aware next action |
| `apps/mobile/components/renova/MaterialPickList.tsx` | `c56a42a935f84e30f04a29fe1827b7053d407574` | material supply editor + approval + truthful supplier-price refresh UX; durable price provenance is governed by `MATERIAL-PRICE-TRUTH-CONTRACT.md` |
| `apps/mobile/components/screens/OsSelectionsScreen.tsx` | `f2e220d292b717f3d903c64dc265337b00a02953` | Selections |
| `apps/mobile/components/screens/OsControlScreen.tsx` | `299b29fe2571900663e290c35bc0096854b8eb7f` | role/access-mode control router |
| `apps/mobile/components/screens/control/CustomerControlView.tsx` | `1a26c543d050225e8ae09179313fc552b9fc00af` | customer acceptance/QC/warranty view |
| `apps/mobile/components/screens/control/ContractorControlView.tsx` | `6c5cd6b869f38502caf180b2e77b2dfa598958dd` | contractor acceptance/QC view |
| `apps/mobile/components/screens/control/TechnicalSupervisionControlView.tsx` | `c0d8856adeb78bdbd856ea8612a244b852af87c9` | technical-supervision control view |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `b04ac08459926439b0533db3decce28a4791843c` | hub tab geometry/progressive disclosure |

При изменении любого source выше `technicalSpecAnnexContract.test.mjs` должен потребовать обновить соответствующий screen contract и этот snapshot. SHA является traceability marker, а не самостоятельным доказательством корректности UX.
