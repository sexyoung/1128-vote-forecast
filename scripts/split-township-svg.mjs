// 把 convert-township-geojson-to-svg.mjs 產出的全臺鄉鎮市區圖，依縣市拆成 22 個
// 檔案，讓地圖可以在點選縣市時才載入該縣市的鄉鎮界線。
//
// 路徑資料原封不動搬過去，座標仍在同一個 860×1100 畫布上，因此與
// taiwan-counties.svg、villages/*.svg 完全對齊。
//
// 全臺單檔放在 scripts/data/ 而不是 public/，因為前端只會抓拆好的縣市檔，
// 放進 public/ 只會讓它跟著 build 進 dist 卻沒人請求。
//
//   node scripts/split-township-svg.mjs
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [
  ,
  ,
  inputPath = 'scripts/data/taiwan-townships.svg',
  outputDirectory = 'public/maps/townships',
] = process.argv;

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

const svg = await readFile(inputPath, 'utf8');
const pathLines = svg.split('\n').filter((line) => line.includes('class="township"'));
if (pathLines.length !== 368) {
  throw new Error(`Expected 368 township paths, found ${pathLines.length}.`);
}

const byCounty = new Map();
for (const line of pathLines) {
  const countyName = /data-county-name="([^"]+)"/.exec(line)?.[1];
  if (!countyName) throw new Error('A township path is missing data-county-name.');
  const county = byCounty.get(countyName) ?? [];
  county.push(line);
  byCounty.set(countyName, county);
}

await mkdir(outputDirectory, { recursive: true });
const index = [];

for (const [countyName, lines] of [...byCounty].sort(([a], [b]) => a.localeCompare(b))) {
  const countyId = countyIds[countyName];
  if (!countyId) throw new Error(`Unknown county: ${countyName}.`);

  const countyCode = /data-county-code="([^"]+)"/.exec(lines[0])?.[1] ?? '';
  const fileName = `${countyId}.svg`;
  const document = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 1100" role="img" aria-labelledby="title description">
  <title id="title">${countyName}鄉鎮市區界線</title>
  <desc id="description">由 scripts/data/taiwan-townships.svg 依縣市拆分，資料版本 2023-03-17。座標系統與 taiwan-counties.svg、villages/*.svg 相同。</desc>
  <metadata>
    Original dataset: https://data.gov.tw/dataset/7441
    License: 政府資料開放授權條款第1版
    Split by scripts/split-township-svg.mjs
  </metadata>
  <style>
    .township { fill: #dce4df; stroke: #fff; stroke-linejoin: round; stroke-width: 0.72; vector-effect: non-scaling-stroke; }
  </style>
  <g class="townships">
${lines.sort().join('\n')}
  </g>
</svg>
`;

  const filePath = join(outputDirectory, fileName);
  await writeFile(filePath, document, 'utf8');
  const { size } = await stat(filePath);
  index.push({
    countyId,
    countyName,
    countyCode,
    file: fileName,
    townships: lines.length,
    bytes: size,
  });
}

await writeFile(
  join(outputDirectory, 'index.json'),
  `${JSON.stringify(
    {
      source: 'scripts/data/taiwan-townships.svg',
      dataset: 'https://data.gov.tw/dataset/7441',
      dataVersion: '2023-03-17',
      viewBox: '0 0 860 1100',
      townships: pathLines.length,
      counties: index,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const total = index.reduce((sum, county) => sum + county.bytes, 0);
console.log(`Wrote ${index.length} county files to ${outputDirectory}/`);
console.log(`${pathLines.length} townships, ${(total / 1024).toFixed(0)} KB total.`);
