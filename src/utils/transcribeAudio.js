/**
 * transcribeAudio.js — the one way Nora turns a recording into text.
 *
 * Every dictation surface (chat bars, Schedule of Condition, notices, dispute
 * agreement) records audio and sends it through here to Whisper
 * (/api/transcribe). Nothing uses the browser's built-in speech engine for
 * text any more — that engine re-sends overlapping phrases, which is what
 * produced the same sentence repeated many times.
 */

// Vercel rejects request bodies over ~4.5MB before our function runs. A
// recording under this goes straight up; a bigger one is decoded to 16kHz
// mono and sent in ~100 second WAV pieces (~3.2MB each) instead.
const DIRECT_LIMIT_BYTES = 4 * 1024 * 1024;
const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 100;

// Added 2026-09-24 — Vercel's serverless functions have a hard ~4.5MB
// request body limit, enforced at the platform level regardless of
// function config (bodyParser: false doesn't change it). An uploaded
// recording of any real length exceeds this easily, so a direct
// upload fails with a non-JSON "Request Entity Too Large" response
// before the function code even runs. Fixed by decoding and
// resampling the recording to 16kHz mono in-browser (Whisper doesn't
// need more than that for speech, and it cuts file size dramatically),
// then slicing it into ~100-second WAV chunks (~3.2MB each, safely
// under the limit) and transcribing each in a separate request,
// concatenating the results in order. Works for a recording of any
// length, not just files that happen to fit under one request.
export async function decodeAndResampleMono(arrayBuffer, targetSampleRate) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    ctx.close();
  }
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetSampleRate) + 1, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0); // mono Float32Array at targetSampleRate
}

export function encodeWavChunk(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// One request to Whisper, retried on network blips and server errors so a
// long dictation is not lost to a single failed upload.
async function postOnce(blob, filename, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryable = true;
    try {
      const formData = new FormData();
      formData.append('audio', blob, filename);
      const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) return String(data.text || '').trim();
      const detail = data?.error || data?.message || (data ? JSON.stringify(data) : 'unreadable reply');
      lastError = new Error(`Transcription failed (${res.status}): ${detail}`);
      // A client error (bad or oversized file) will not improve on retry.
      retryable = !(res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
    } catch (error) {
      lastError = error; // network failure — worth another go
    }
    if (!retryable || attempt === attempts) break;
    await wait(800 * attempt);
  }
  throw lastError || new Error('Transcription failed.');
}

/**
 * @param {Blob} blob   the recorded audio
 * @param {{ onProgress?: (message: string) => void }} [options]
 * @returns {Promise<string>} the transcript (empty string if no speech)
 */
export async function transcribeAudio(blob, { onProgress } = {}) {
  if (!blob || blob.size === 0) return '';

  if (blob.size < DIRECT_LIMIT_BYTES) {
    const extension = (blob.type || '').includes('mp4') ? 'mp4' : (blob.type || '').includes('wav') ? 'wav' : 'webm';
    return postOnce(blob, `voice.${extension}`);
  }

  onProgress?.('Preparing recording…');
  const samples = await decodeAndResampleMono(await blob.arrayBuffer(), SAMPLE_RATE);
  const chunkSize = SAMPLE_RATE * CHUNK_SECONDS;
  const totalChunks = Math.max(1, Math.ceil(samples.length / chunkSize));
  const texts = [];

  for (let i = 0; i < totalChunks; i += 1) {
    onProgress?.(`Transcribing part ${i + 1} of ${totalChunks}…`);
    const piece = samples.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, samples.length));
    const text = await postOnce(encodeWavChunk(piece, SAMPLE_RATE), `chunk-${i}.wav`);
    if (text) texts.push(text);
  }

  return texts.join(' ').trim();
}
