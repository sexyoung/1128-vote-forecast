import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [, , inputPath, outputPath = 'public/maps/taiwan-counties.svg'] = process.argv;

if (!inputPath) {
  console.error('Usage: node scripts/convert-county-gml-to-svg.mjs <input.gml> [output.svg]');
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

const xml = await readFile(inputPath, 'utf8');
const features = parseFeatures(xml);
const dataDate = parseDataDate(xml);

if (features.length !== 22) {
  throw new Error(`Expected 22 counties/cities, received ${features.length}.`);
}

const projections = createProjections(features);
const paths = features.map((feature) => renderFeature(feature, projections)).join('\n');
const insetFrames = Object.entries(frames)
  .filter(([, frame]) => frame.label)
  .map(
    ([region, frame]) => `    <g class="inset" data-region="${region}">
      <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="10" />
      <text x="${frame.x + 9}" y="${frame.y + 18}">${frame.label}</text>
    </g>`,
  )
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 1100" role="img" aria-labelledby="title description">
  <title id="title">臺灣直轄市、縣市界線</title>
  <desc id="description">由內政部國土測繪中心 TWD97 經緯度 GML 轉換，資料日期 ${dataDate}。</desc>
  <metadata>
    Source: https://data.gov.tw/dataset/7442
    License: 政府資料開放授權條款第1版
    Converted by scripts/convert-county-gml-to-svg.mjs
  </metadata>
  <style>
    .inset rect { fill: none; stroke: #8b9691; stroke-width: 1; }
    .inset text { fill: #52605a; font: 12px sans-serif; }
    .county { fill: #dce4df; stroke: #fff; stroke-linejoin: round; stroke-width: 1.25; vector-effect: non-scaling-stroke; }
  </style>
  <g class="insets" aria-hidden="true">
${insetFrames}
  </g>
  <g class="counties">
${paths}
  </g>
</svg>
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, 'utf8');
console.log(`Wrote ${outputPath}: ${features.length} counties/cities.`);

function parseFeatures(source) {
  return [...source.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)].map(
    ([, featureBlock]) => {
      const name = featureBlock.match(/<名稱>(.*?)<\/名稱>/)?.[1];
      if (!name || !countyIds[name]) {
        throw new Error(`Unknown county/city name: ${name ?? '(missing)'}.`);
      }

      const polygons = [
        ...featureBlock.matchAll(/<gml:polygonMember>([\s\S]*?)<\/gml:polygonMember>/g),
      ].map(([, polygonBlock]) => {
        const outer = parseBoundary(polygonBlock, 'outerBoundaryIs');
        const holes = [
          ...polygonBlock.matchAll(
            /<gml:innerBoundaryIs>[\s\S]*?<gml:coordinates>([\s\S]*?)<\/gml:coordinates>[\s\S]*?<\/gml:innerBoundaryIs>/g,
          ),
        ].map(([, coordinates]) => parseCoordinates(coordinates));

        return { outer, holes, region: classifyRegion(name, outer) };
      });

      return { id: countyIds[name], name, polygons };
    },
  );
}

function parseDataDate(source) {
  const value = source.match(/<gml:timePosition[^>]*>(.*?)<\/gml:timePosition>/)?.[1];
  const match = value?.match(/^(\d{2,3})-(\d{2})-(\d{2})$/);
  if (!match) return value ?? '未標示';
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
}

function parseBoundary(block, boundaryName) {
  const match = block.match(
    new RegExp(
      `<gml:${boundaryName}>[\\s\\S]*?<gml:coordinates>([\\s\\S]*?)<\\/gml:coordinates>[\\s\\S]*?<\\/gml:${boundaryName}>`,
    ),
  );
  if (!match) throw new Error(`Missing ${boundaryName}.`);
  return parseCoordinates(match[1]);
}

function parseCoordinates(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').slice(0, 2).map(Number));
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

  return `    <path id="${feature.id}" class="county" data-name="${feature.name}" aria-label="${feature.name}" fill-rule="evenodd" d="${path}" />`;
}

function renderRing(points) {
  const simplified = simplifyClosedRing(points, 0.28);
  return `M${simplified.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
}

function simplifyClosedRing(points, tolerance) {
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

  const firstHalf = simplifyLine(open.slice(0, splitIndex + 1), tolerance);
  const secondHalf = simplifyLine([...open.slice(splitIndex), open[0]], tolerance);
  const merged = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  return merged.length >= 3 ? merged : open;
}

function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points;
  const threshold = tolerance * tolerance;
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
  const left = simplifyLine(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyLine(points.slice(splitIndex), tolerance);
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

function round(value) {
  return Number(value.toFixed(2));
}
