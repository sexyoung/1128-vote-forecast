type GeoFields = {
  lastCountry: string | null;
  lastRegion: string | null;
  lastCity: string | null;
};

export function countryName(code: string | null) {
  if (!code) return null;
  if (code === 'T1') return 'Tor 網路';
  try {
    return new Intl.DisplayNames(['zh-TW'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function inferredLocation(fields: GeoFields) {
  return (
    [
      ...new Set(
        [countryName(fields.lastCountry), fields.lastRegion, fields.lastCity].filter(Boolean),
      ),
    ].join(' · ') || '無法推測'
  );
}
