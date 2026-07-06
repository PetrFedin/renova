/** Voice record stub — web: MediaRecorder, native: placeholder */
export async function recordVoiceStub(): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return '[голос записан — отправка на Whisper]';
    } catch { return '[микрофон недоступен]'; }
  }
  return '[запись голоса: используйте web preview]';
}
