// 村里界圖 → 每個縣市一個 SVG，座標與 taiwan-counties.svg、taiwan-townships.svg
// 共用同一個 860×1100 畫布，因此三層可以直接疊在一起。
//
// 取得來源資料（內政部國土測繪中心，政府資料開放平臺 dataset 7438）：
//   curl -L -o village.zip 'https://www.tgos.tw/tgos/VirtualDir/Product/a04697c8-64db-450a-a105-3eb471c45abd/%E6%9D%91(%E9%87%8C)%E7%95%8C(TWD97%E7%B6%93%E7%B7%AF%E5%BA%A6).zip'
//   unzip village.zip -d village
//   npx -y shapefile … 或任何 shp→geojson 工具，輸出 UTF-8 的 FeatureCollection
//   node scripts/convert-village-geojson-to-svg.mjs villages.geojson
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [, , inputPath, outputDirectory = 'public/maps/villages'] = process.argv;

if (!inputPath) {
  console.error(
    'Usage: node scripts/convert-village-geojson-to-svg.mjs <input.geojson> [output-directory]',
  );
  process.exit(1);
}

const countyIds = {
  連江縣: 'lienchiang-county',
  宜蘭縣: 'yilan-county',
  彰化縣: 'changhua-county',
  南投縣: 'nantou-county',
  雲林縣: 'yunlin-county',
  屏東縣: 'pingtung-county',
  基隆市: 'keelung-city',
  臺北市: 'taipei-city',
  新北市: 'new-taipei-city',
  臺南市: 'tainan-city',
  桃園市: 'taoyuan-city',
  嘉義市: 'chiayi-city',
  嘉義縣: 'chiayi-county',
  金門縣: 'kinmen-county',
  高雄市: 'kaohsiung-city',
  臺東縣: 'taitung-county',
  花蓮縣: 'hualien-county',
  澎湖縣: 'penghu-county',
  新竹市: 'hsinchu-city',
  臺中市: 'taichung-city',
  苗栗縣: 'miaoli-county',
  新竹縣: 'hsinchu-county',
};

const frames = {
  main: { x: 184, y: 20, width: 652, height: 1060, padding: 8 },
  matsu: { x: 18, y: 30, width: 140, height: 110, padding: 15, label: '馬祖' },
  kinmen: { x: 18, y: 185, width: 140, height: 110, padding: 15, label: '金門' },
  penghu: { x: 18, y: 340, width: 140, height: 150, padding: 15, label: '澎湖' },
  diaoyu: { x: 18, y: 535, width: 140, height: 100, padding: 15, label: '釣魚臺列嶼' },
  dongsha: { x: 18, y: 680, width: 140, height: 100, padding: 15, label: '東沙群島' },
  nansha: { x: 18, y: 825, width: 140, height: 150, padding: 15, label: '南沙群島' },
};

// Villages are drawn ten times closer than townships, so the simplifier keeps
// roughly 20 m of detail instead of the 100 m that reads fine at county zoom.
const tolerance = 0.05;

const geojson = JSON.parse(await readFile(inputPath, 'utf8'));
if (geojson.type !== 'FeatureCollection' || geojson.features.length !== 7986) {
  throw new Error('Expected a 7986-feature FeatureCollection.');
}

const features = geojson.features.map(normalizeFeature);
// The projection is fitted over every village so the layer shares the county and
// township canvas; splitting per county happens only after the fit.
const projections = createProjections(features);

const byCounty = new Map();
for (const feature of features) {
  const county = byCounty.get(feature.countyName) ?? [];
  county.push(feature);
  byCounty.set(feature.countyName, county);
}

await mkdir(outputDirectory, { recursive: true });
const index = [];

for (const [countyName, countyFeatures] of [...byCounty].sort(([a], [b]) => a.localeCompare(b))) {
  const countyId = countyIds[countyName];
  if (!countyId) throw new Error(`Unknown county: ${countyName}.`);

  const fileName = `${countyId}.svg`;
  const paths = countyFeatures
    .map((feature) => renderFeature(feature, projections))
    .sort()
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 1100" role="img" aria-labelledby="title description">
  <title id="title">${countyName}村里界線</title>
  <desc id="description">由 VILLAGE_NLSC_1150817.shp 轉換，資料版本 2026-08-17。座標系統與 taiwan-counties.svg、taiwan-townships.svg 相同。</desc>
  <metadata>
    Geometry source: VILLAGE_NLSC_1150817.shp
    Original dataset: https://data.gov.tw/dataset/7438
    License: 政府資料開放授權條款第1版
    Converted by scripts/convert-village-geojson-to-svg.mjs
  </metadata>
  <style>
    .village { fill: #dce4df; stroke: #fff; stroke-linejoin: round; stroke-width: 0.4; vector-effect: non-scaling-stroke; }
    .village.unassigned { fill: #eef1ef; }
  </style>
  <g class="villages">
${paths}
  </g>
</svg>
`;

  const filePath = join(outputDirectory, fileName);
  await writeFile(filePath, svg, 'utf8');
  const { size } = await stat(filePath);
  index.push({
    countyId,
    countyName,
    countyCode: countyFeatures[0].countyCode,
    file: fileName,
    villages: countyFeatures.length,
    bytes: size,
  });
}

await writeFile(
  join(outputDirectory, 'index.json'),
  `${JSON.stringify(
    {
      source: 'VILLAGE_NLSC_1150817.shp',
      dataset: 'https://data.gov.tw/dataset/7438',
      dataVersion: '2026-08-17',
      viewBox: '0 0 860 1100',
      villages: features.length,
      counties: index,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const total = index.reduce((sum, county) => sum + county.bytes, 0);
console.log(`Wrote ${index.length} county files to ${outputDirectory}/`);
console.log(`${features.length} villages, ${(total / 1024 / 1024).toFixed(2)} MB total.`);

function normalizeFeature(feature) {
  const properties = feature.properties ?? {};
  const { NOTE: note, VILLCODE: villCode, VILLNAME: villName } = properties;
  const { TOWNCODE: townCode, TOWNID: townId, TOWNNAME: townName } = properties;
  const { COUNTYCODE: countyCode, COUNTYNAME: countyName } = properties;
  if (!villCode || !townCode || !countyName) {
    throw new Error('VILLCODE, TOWNCODE and COUNTYNAME are required.');
  }
  // 206 polygons — offshore islets, harbours and reclaimed land — carry no
  // village name and are marked 未編定村里 in NOTE instead.
  if (!villName && note !== '未編定村里') {
    throw new Error(`Village ${villCode} has neither VILLNAME nor a 未編定村里 note.`);
  }

  const geometry = feature.geometry;
  const sourcePolygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : null;
  if (!sourcePolygons) throw new Error(`Unsupported geometry: ${geometry.type}.`);

  const polygons = sourcePolygons.map(([outer, ...holes]) => ({
    outer,
    holes,
    region: classifyRegion(countyName, outer),
  }));

  return {
    countyCode,
    countyName,
    polygons,
    townCode,
    townId,
    townName,
    villCode,
    villName: villName ?? '',
  };
}

function classifyRegion(countyName, ring) {
  if (countyName === '連江縣') return 'matsu';
  if (countyName === '金門縣') return 'kinmen';
  if (countyName === '澎湖縣') return 'penghu';

  const [longitude, latitude] = centroid(ring);
  if (latitude < 18) return 'nansha';
  if (latitude < 21.5) return 'dongsha';
  if (longitude > 122.2) return 'diaoyu';
  return 'main';
}

function centroid(points) {
  const total = points.reduce(
    ([longitude, latitude], [x, y]) => [longitude + x, latitude + y],
    [0, 0],
  );
  return [total[0] / points.length, total[1] / points.length];
}

function createProjections(items) {
  const pointsByRegion = Object.fromEntries(Object.keys(frames).map((region) => [region, []]));
  for (const feature of items) {
    for (const polygon of feature.polygons) {
      for (const point of polygon.outer) pointsByRegion[polygon.region].push(point);
      for (const hole of polygon.holes) {
        for (const point of hole) pointsByRegion[polygon.region].push(point);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(pointsByRegion).map(([region, points]) => [
      region,
      fitProjection(points, frames[region]),
    ]),
  );
}

function fitProjection(points, frame) {
  if (points.length === 0) return ([x, y]) => [x, y];

  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  for (const [longitude, latitude] of points) {
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }

  const latitudeScale = Math.cos((((minLatitude + maxLatitude) / 2) * Math.PI) / 180);
  const width = Math.max((maxLongitude - minLongitude) * latitudeScale, Number.EPSILON);
  const height = Math.max(maxLatitude - minLatitude, Number.EPSILON);
  const availableWidth = frame.width - frame.padding * 2;
  const availableHeight = frame.height - frame.padding * 2;
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const offsetX = frame.x + (frame.width - width * scale) / 2;
  const offsetY = frame.y + (frame.height - height * scale) / 2;

  return ([longitude, latitude]) => [
    offsetX + (longitude - minLongitude) * latitudeScale * scale,
    offsetY + (maxLatitude - latitude) * scale,
  ];
}

function renderFeature(feature, projections) {
  const path = feature.polygons
    .map(({ outer, holes, region }) => {
      const project = projections[region];
      return [outer, ...holes].map((ring) => renderRing(ring.map(project))).join('');
    })
    .join('');
  const label = `${feature.countyName}${feature.townName}${feature.villName || '未編定村里'}`;
  const className = feature.villName ? 'village' : 'village unassigned';

  return `    <path id="vill-${feature.villCode}" class="${className}" data-vill-code="${feature.villCode}" data-vill-name="${feature.villName}" data-town-id="${feature.townId}" data-town-code="${feature.townCode}" data-town-name="${feature.townName}" data-county-code="${feature.countyCode}" data-county-name="${feature.countyName}" aria-label="${label}" fill-rule="evenodd" d="${path}" />`;
}

function renderRing(points) {
  const simplified = simplifyClosedRing(points, tolerance);
  return `M${deduplicateRounded(simplified)
    .map(([x, y]) => `${x} ${y}`)
    .join('L')}Z`;
}

function deduplicateRounded(points) {
  const rounded = points.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);
  const unique = rounded.filter(
    (point, index) => index === 0 || !samePoint(point, rounded[index - 1]),
  );
  return unique.length >= 3 ? unique : rounded;
}

function simplifyClosedRing(points, ringTolerance) {
  const open = samePoint(points[0], points.at(-1)) ? points.slice(0, -1) : points.slice();
  if (open.length <= 4) return open;

  let splitIndex = 1;
  let farthestDistance = 0;
  for (let index = 1; index < open.length; index += 1) {
    const distance = squaredDistance(open[0], open[index]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      splitIndex = index;
    }
  }

  const firstHalf = simplifyLine(open.slice(0, splitIndex + 1), ringTolerance);
  const secondHalf = simplifyLine([...open.slice(splitIndex), open[0]], ringTolerance);
  const merged = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  return merged.length >= 3 ? merged : open;
}

function simplifyLine(points, lineTolerance) {
  if (points.length <= 2) return points;
  const threshold = lineTolerance * lineTolerance;
  let maxDistance = threshold;
  let splitIndex = -1;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = squaredSegmentDistance(points[index], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  if (splitIndex === -1) return [points[0], points.at(-1)];
  const left = simplifyLine(points.slice(0, splitIndex + 1), lineTolerance);
  const right = simplifyLine(points.slice(splitIndex), lineTolerance);
  return [...left.slice(0, -1), ...right];
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let deltaX = end[0] - x;
  let deltaY = end[1] - y;

  if (deltaX !== 0 || deltaY !== 0) {
    const ratio =
      ((point[0] - x) * deltaX + (point[1] - y) * deltaY) / (deltaX * deltaX + deltaY * deltaY);
    if (ratio > 1) {
      x = end[0];
      y = end[1];
    } else if (ratio > 0) {
      x += deltaX * ratio;
      y += deltaY * ratio;
    }
  }

  deltaX = point[0] - x;
  deltaY = point[1] - y;
  return deltaX * deltaX + deltaY * deltaY;
}

function squaredDistance(first, second) {
  const x = first[0] - second[0];
  const y = first[1] - second[1];
  return x * x + y * y;
}

function samePoint(first, second) {
  return first?.[0] === second?.[0] && first?.[1] === second?.[1];
}
