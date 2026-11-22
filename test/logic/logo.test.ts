import { describe, expect, it } from 'vitest';
import { LOGO_COLORS, logoColor, monogram } from '@shared/logo';

describe('company monograms', () => {
  it('uses the first letter of the first word', () => {
    expect(monogram('Tessellate')).toBe('T');
    expect(monogram('kestrel bank')).toBe('K');
    expect(monogram('  Parcel & Pine')).toBe('P');
    expect(monogram('3M')).toBe('3');
  });

  it('skips a leading article', () => {
    expect(monogram('The Copperleaf Group')).toBe('C');
    expect(monogram('A Cloud Guru')).toBe('C');
    expect(monogram('An Post')).toBe('P');
    expect(monogram('Le Monde')).toBe('M');
    expect(monogram('Die Zeit')).toBe('Z');
    expect(monogram("l'Atelier")).toBe('A');
  });

  it('keeps an article that is the whole name, and copes with nothing usable', () => {
    expect(monogram('The')).toBe('T');
    expect(monogram('A')).toBe('A');
    expect(monogram('Theory')).toBe('T');
    expect(monogram('Ångström Labs')).toBe('Å');
    expect(monogram('   ')).toBe('?');
  });

  it('has ten colors, ultramarine first and the default', () => {
    expect(LOGO_COLORS).toHaveLength(10);
    expect(logoColor(null).key).toBe('ultramarine');
    expect(logoColor('nope').key).toBe('ultramarine');
    expect(logoColor('teal').key).toBe('teal');
  });
});
