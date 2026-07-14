# Document Center — Wave 3e (Native DocumentPicker)

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova

## Зачем

Wave 3d дал web-upload. На iOS/Android кнопка «+ Файл» ещё показывала заглушку.  
Нужен нативный выбор PDF/DOC/фото через Expo, без отдельного экрана.

## Решение

### Dependency
- `expo-document-picker` (~56, SDK-совместим) в `apps/mobile`

### Helper `apps/mobile/lib/documentUploadPick.ts`
| Платформа | Поведение |
|-----------|-----------|
| web | `<input type=file>` |
| iOS/Android | `DocumentPicker.getDocumentAsync` (PDF, images, office) |
| Fallback | `ImagePicker` галерея, если DocumentPicker недоступен |

### DocumentsHub
Alert на native: **Файл (PDF, DOC…)** | **Фото из галереи** | Отмена  
Далее тот же `uploadProjectDocument` multipart → индекс перезагружается (OCR meta как в 3d).

### Permissions
- iOS: `NSPhotoLibraryUsageDescription` (если отсутствовал)
- Android: `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE`

## Acceptance

1. `npm run test:docs-upload` OK  
2. `npm run test:priority` green  
3. На device/simulator: Documents → + Файл → PDF/фото → документ в индексе  

## Не делаем

- Auto-merge PR #2 (нужна фраза «мержи PR #2»)
- Cloud OCR / Kontur SDK

## Связь

- WAVE3D (hub actions)
- WAVE3C (async OCR на API)
