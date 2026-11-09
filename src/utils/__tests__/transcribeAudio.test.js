import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from '../transcribeAudio.js';

const audio = (bytes = 5000) => new Blob([new Uint8Array(bytes)], { type: 'audio/webm' });
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('transcribeAudio', () => {
  it('returns the transcript for a normal recording', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { success: true, text: '  Hello surveyor  ' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribeAudio(audio())).resolves.toBe('Hello surveyor');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty string for an empty recording without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribeAudio(new Blob([]))).resolves.toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a server error and then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(502, { error: 'bad gateway' }))
      .mockResolvedValueOnce(reply(200, { success: true, text: 'Second time lucky' }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = transcribeAudio(audio());
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe('Second time lucky');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped connection', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(reply(200, { success: true, text: 'Back online' }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = transcribeAudio(audio());
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe('Back online');
  });

  it('does not retry a rejected file (client error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(413, { error: 'too large' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribeAudio(audio())).rejects.toThrow(/413/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after three failed attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(reply(500, { error: 'down' }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = transcribeAudio(audio());
    const assertion = expect(pending).rejects.toThrow(/500/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
