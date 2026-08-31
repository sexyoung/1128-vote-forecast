import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';

describe('forecast candidate photos', () => {
  it('renders the photo supplied by the contest target and crops it into the mark', async () => {
    const [component, styles] = await Promise.all([
      readFile(new URL('./ForecastSheet.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);
    const photoRule = styles.slice(
      styles.indexOf('.forecast-mark img {'),
      styles.indexOf('.forecast-option-text {'),
    );

    expect(component).toContain('<CandidatePhoto photo={target.photo} />');
    expect(photoRule).toContain('object-fit: cover;');
    expect(photoRule).toContain('position: absolute;');
  });

  it('leaves room around the option while its selected animation scales up', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const optionsRule = styles.slice(
      styles.indexOf('.forecast-options {'),
      styles.indexOf('.forecast-options label {'),
    );
    const selectedRule = styles.slice(
      styles.indexOf('.forecast-options label.selected {'),
      styles.indexOf('/* 蓋章：'),
    );

    expect(optionsRule).toContain('padding: 4px;');
    expect(selectedRule).toContain('z-index: 1;');
  });
});
