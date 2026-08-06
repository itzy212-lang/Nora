import { describe, it, expect } from 'vitest';
import { resolveEffectiveVoice, buildGoldStandardBlock, renderBannedPhrases } from '../v2-voice-resolution.js';

describe('resolveEffectiveVoice — four-level precedence, levels 3 and 4', () => {
  it('uses Default Voice Profile alone when no user_brain_v2 row exists', () => {
    const result = resolveEffectiveVoice({ defaultVoiceProfile: 'DEFAULT VOICE CONTENT', userBrainV2: null });
    expect(result.effectiveVoiceProfileId).toBe('default_voice_profile_v2');
    expect(result.text).toContain('DEFAULT VOICE CONTENT');
  });

  it('extends the default with user voice content when a user_brain_v2 row exists', () => {
    const result = resolveEffectiveVoice({
      defaultVoiceProfile: 'DEFAULT VOICE CONTENT',
      userBrainV2: { user_id: 'abc', voice_content: 'ITZIK VOICE CONTENT' },
    });
    expect(result.text).toContain('DEFAULT VOICE CONTENT');
    expect(result.text).toContain('ITZIK VOICE CONTENT');
    expect(result.effectiveVoiceProfileId).toBe('user_brain_v2:abc');
  });

  it('includes identity and banned phrases when present on the user row', () => {
    const result = resolveEffectiveVoice({
      defaultVoiceProfile: 'DEFAULT',
      userBrainV2: {
        user_id: 'abc',
        voice_content: 'VOICE',
        identity_content: 'IDENTITY TEXT',
        banned_phrases: 'BANNED TEXT',
      },
    });
    expect(result.text).toContain('IDENTITY TEXT');
    expect(result.text).toContain('BANNED TEXT');
  });

  it('does not include an identity or banned-phrases section when absent (no empty placeholders)', () => {
    const result = resolveEffectiveVoice({ defaultVoiceProfile: 'DEFAULT', userBrainV2: null });
    const names = result.sections.map((s) => s.name);
    expect(names).not.toContain('user_identity');
    expect(names).not.toContain('user_banned_phrases');
  });
});

describe('renderBannedPhrases — prefers structured form, falls back to text (additive schema, 2026-08-06)', () => {
  it('uses banned_phrases_structured when present, rendering every group', () => {
    const text = renderBannedPhrases({
      banned_phrases_structured: {
        general: ['duly', 'accordingly'],
        domain_specific: { note: 'SOC contexts', phrases: ['serviceable'] },
        openers: ['We refer to'],
        closers: ['I remain'],
        punctuation_and_formatting: ['Do not use long dashes.'],
      },
      banned_phrases: 'OLD TEXT FORM',
    });
    expect(text).toContain('duly');
    expect(text).toContain('accordingly');
    expect(text).toContain('serviceable');
    expect(text).toContain('We refer to');
    expect(text).toContain('I remain');
    expect(text).toContain('Do not use long dashes.');
    expect(text).not.toContain('OLD TEXT FORM');
  });

  it('falls back to the plain banned_phrases text when banned_phrases_structured is absent', () => {
    const text = renderBannedPhrases({ banned_phrases: 'OLD TEXT FORM ONLY' });
    expect(text).toBe('OLD TEXT FORM ONLY');
  });

  it('returns null when neither field is present', () => {
    expect(renderBannedPhrases({})).toBeNull();
    expect(renderBannedPhrases(null)).toBeNull();
  });
});

describe('resolveEffectiveVoice — fee structure and sign-off (additive schema, 2026-08-06)', () => {
  it('includes fee_structure_content when present', () => {
    const result = resolveEffectiveVoice({
      defaultVoiceProfile: 'DEFAULT',
      userBrainV2: { user_id: 'abc', voice_content: 'VOICE', fee_structure_content: 'FEE SCHEDULE TEXT' },
    });
    expect(result.text).toContain('FEE SCHEDULE TEXT');
  });

  it('includes an explicit sign-off instruction when sign_off is present, and nothing after it', () => {
    const result = resolveEffectiveVoice({
      defaultVoiceProfile: 'DEFAULT',
      userBrainV2: { user_id: 'abc', voice_content: 'VOICE', sign_off: 'Kind regards,' },
    });
    expect(result.text).toContain('Sign off with: Kind regards,');
    expect(result.text).toContain('Nothing may appear after it.');
  });

  it('prefers banned_phrases_structured over banned_phrases when both are present', () => {
    const result = resolveEffectiveVoice({
      defaultVoiceProfile: 'DEFAULT',
      userBrainV2: {
        user_id: 'abc',
        voice_content: 'VOICE',
        banned_phrases: 'OLD FORM SHOULD NOT APPEAR',
        banned_phrases_structured: { general: ['newly structured phrase'] },
      },
    });
    expect(result.text).toContain('newly structured phrase');
    expect(result.text).not.toContain('OLD FORM SHOULD NOT APPEAR');
  });
});

describe('buildGoldStandardBlock — explicit authority framing, not anonymous JSON', () => {
  const example = { id: 'ex-1', category: 'short_factual_reply', example_response: 'Hi Robin, ...' };

  it('returns null when no example is supplied (no fabricated framing around nothing)', () => {
    expect(buildGoldStandardBlock({ example: null, userBrainV2: null })).toBeNull();
  });

  it('includes an explicit framing sentence before the JSON, not a bare label', () => {
    const block = buildGoldStandardBlock({ example, userBrainV2: null });
    expect(block.text).toMatch(/demonstrate how.*naturally structures/i);
    const jsonIndex = block.text.indexOf('"id": "ex-1"');
    const framingIndex = block.text.indexOf('demonstrate how');
    expect(framingIndex).toBeGreaterThanOrEqual(0);
    expect(framingIndex).toBeLessThan(jsonIndex);
  });

  it('includes an explicit authority statement that generic guidance yields to demonstrated style', () => {
    const block = buildGoldStandardBlock({ example, userBrainV2: null });
    expect(block.text).toMatch(/authoritative guide for all written output/i);
    expect(block.text).toMatch(/must not replace the user's tone/i);
  });

  it('uses the user-specific framing text when the user_brain_v2 row supplies one', () => {
    const block = buildGoldStandardBlock({
      example,
      userBrainV2: { gold_standard_framing: 'CUSTOM FRAMING TEXT' },
    });
    expect(block.text).toContain('CUSTOM FRAMING TEXT');
  });

  it('the example JSON itself is present and parseable', () => {
    const block = buildGoldStandardBlock({ example, userBrainV2: null });
    const match = block.text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match[0]);
    expect(parsed[0].id).toBe('ex-1');
  });
});
