import { describe, it, expect } from 'vitest';
import { parseGeminiJson } from '../app/api/_lib/parseJson';

describe('parseGeminiJson', () => {
  it('parses a clean JSON string', () => {
    const raw = '{"name": "Sydney", "is_suburb": true}';
    const parsed = parseGeminiJson(raw);
    expect(parsed).toEqual({ name: 'Sydney', is_suburb: true });
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"name": "Newtown", "is_suburb": true}\n```';
    const parsed = parseGeminiJson(raw);
    expect(parsed).toEqual({ name: 'Newtown', is_suburb: true });
  });

  it('strips thinking blocks and preamble', () => {
    const raw = '<think>I need to return json</think>\nHere is the data:\n{"name": "Manly", "is_suburb": true}\nEnjoy!';
    const parsed = parseGeminiJson(raw);
    expect(parsed).toEqual({ name: 'Manly', is_suburb: true });
  });

  it('throws an error if no JSON block is found', () => {
    const raw = 'This is just some text without braces.';
    expect(() => parseGeminiJson(raw)).toThrow(/No valid JSON object/);
  });
});
