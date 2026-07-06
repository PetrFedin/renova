/** Whisper transcribe stub — подключите EXPO_PUBLIC_WHISPER_URL */
export async function transcribeAudio(base64: string): Promise<string> {
  const url = process.env.EXPO_PUBLIC_WHISPER_URL;
  if (!url) return '[голос: Whisper URL не настроен]';
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: base64 }) });
    const j = await r.json();
    return j.text || '[голос: пустой ответ]';
  } catch {
    return '[голос: ошибка транскрипции]';
  }
}
