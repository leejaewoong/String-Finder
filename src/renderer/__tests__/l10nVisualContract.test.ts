import fs from 'node:fs';
import path from 'node:path';
import postcss, { Root } from 'postcss';
import tailwindcss from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const COLORS = {
  background: [44, 44, 44],
  surface: [56, 56, 56],
  border: [74, 74, 74],
  text: [255, 255, 255],
  secondaryText: [179, 179, 179],
  primary: [24, 160, 251],
} as const;

let stylesheet: Root;

function getDeclaration(selector: string, property: string): string | undefined {
  let value: string | undefined;

  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;

    rule.walkDecls(property, (declaration) => {
      value = declaration.value;
    });
  });

  return value;
}

function parseColor(value: string | undefined): number[] | undefined {
  if (!value) return undefined;

  const hex = value.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) {
    return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  }

  const rgb = value.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/i);
  return rgb?.slice(1).map(Number);
}

beforeAll(async () => {
  const cssPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');
  const result = await postcss([
    tailwindcss(path.resolve(process.cwd(), 'tailwind.config.js')),
  ]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });

  stylesheet = postcss.parse(result.css);
});

describe('String ID 생성 탭 visual contract', () => {
  it('uses the search tab surface and border colors for panels and fields', () => {
    expect(parseColor(getDeclaration('.l10n-screen', 'background-color'))).toEqual(COLORS.background);
    expect(parseColor(getDeclaration('.l10n-panel', 'background-color'))).toEqual(COLORS.background);
    expect(parseColor(getDeclaration('.l10n-panel', 'border-color'))).toEqual(COLORS.border);
    expect(parseColor(getDeclaration('.l10n-field input', 'background-color'))).toEqual(COLORS.surface);
    expect(parseColor(getDeclaration('.l10n-field input', 'border-color'))).toEqual(COLORS.border);
    expect(parseColor(getDeclaration('.l10n-field-tooltip', 'background-color'))).toEqual(COLORS.surface);
    expect(parseColor(getDeclaration('.l10n-issue-group li', 'background-color'))).toEqual(COLORS.surface);
  });

  it('uses a 28px heading centered within the action row', () => {
    expect(getDeclaration('.l10n-heading-row', 'align-items')).toBe('center');
    expect(getDeclaration('.l10n-heading-row h2', 'font-size')).toBe('28px');
    expect(getDeclaration('.l10n-heading-row h2', 'line-height')).toBe('36px');
    expect(parseColor(getDeclaration('.l10n-heading-row h2', 'color'))).toEqual(COLORS.text);
    expect(parseColor(getDeclaration('.l10n-field-title', 'color'))).toEqual(COLORS.secondaryText);
    expect(parseColor(getDeclaration('.l10n-field input', 'color'))).toEqual(COLORS.text);
    expect(parseColor(getDeclaration('.l10n-issue-group p', 'color'))).toEqual(COLORS.secondaryText);
  });

  it('uses the search tab button colors for secondary and primary actions', () => {
    expect(parseColor(getDeclaration('.l10n-button.is-generate', 'background-color'))).toEqual(COLORS.surface);
    expect(parseColor(getDeclaration('.l10n-button.is-generate', 'border-color'))).toEqual(COLORS.border);
    expect(parseColor(getDeclaration('.l10n-button.is-generate', 'color'))).toEqual(COLORS.text);
    expect(parseColor(getDeclaration('.l10n-button.is-finalize', 'background-color'))).toEqual(COLORS.primary);
  });

  it('uses the search tab primary color for keyboard focus', () => {
    expect(getDeclaration('.app-tab:focus-visible', 'box-shadow')).toContain('#18a0fb');
    expect(getDeclaration('.l10n-button:focus-visible', 'box-shadow')).toContain('#18a0fb');
  });
});
