const areaTwoLineLimit = 26;

export function summariseArea(area: string) {
  const parts = area.split('、');
  if (area.length <= areaTwoLineLimit || parts.length < 3) return area;
  const units = new Set(parts.map((part) => part.slice(-1)));
  const unit = units.size === 1 ? `個${[...units][0]}` : '個區域';
  return `${parts[0]}、${parts[1]} 等 ${parts.length} ${unit}`;
}
