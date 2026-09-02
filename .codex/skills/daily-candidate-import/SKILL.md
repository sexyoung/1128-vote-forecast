---
name: daily-candidate-import
description: Research Taiwan local-election candidates newly announced or registered today across all supported parties, then prepare an import CSV and verified avatar assets. Use for daily election-candidate updates; do not use for unrelated election analysis.
---

# Daily candidate import

Use this skill when asked to check today's newly announced or registered local-election candidates.

## Outcome

Use the date in `Asia/Taipei`. Without writing to the database, produce:

- `docs/daily-candidate-imports/{YYYY-MM-DD}-import.csv`, with the exact candidate-import schema below. Include only genuinely new candidates.
- One square avatar for every CSV row at `public/avatars/{code}.webp`.
- One provenance row per new avatar in `public/avatars/sources.csv`.

The CSV may contain only its header when no new candidate qualifies. Do not create a separate daily `registered.csv` or `avatar-sources.csv`.

## Research and matching

1. Check the Central Election Commission and relevant county/city election commissions first. Then check the official announcements of every supported party, followed by reputable local reporting. Preserve the source URL for every candidate and avatar.
2. Search every day for candidates from all of these parties: 民主進步黨 (DPP), 中國國民黨 (KMT), 台灣民眾黨 (TPP), 時代力量 (NPP), 台灣基進 (TSP), 親民黨 (PFP), 台灣團結聯盟 (TSU), 新黨 (NP), 台灣綠黨 (GPT), 社會民主黨 (SDP), 中華民族致公黨 (CMG), 勞動黨 (LABOR), 無黨團結聯盟 (NPSU), 小民參政歐巴桑聯盟 (OBA), 台灣工黨 (TWP), 司法改革黨 (JRP), 正神名黨 (ZSM), 麻將黨 (MJP). Also capture unaffiliated registrations when a reliable election source identifies them.
3. Include a person only when their name, office, and election area match an existing `contestId` in `src/server/data/election-contests.json`.
4. Query the current database by name and contest before creating a row. Ignore IDs containing `-CANDIDATE-` for this check. If any real candidate already exists, omit that person from this day's CSV and do not research, download, or add another avatar.
5. Completed registration is eligible with status `REGISTERED`, even if qualification review or party recommendation may later change. Do not describe registration as final qualification. Do not include a planned registration, party nomination, or primary result as a registration.
6. Never infer party affiliation. Use a party code only when a source establishes it; otherwise use `IND`. Valid codes are in `src/shared/candidates.ts`.

## Candidate CSV

The header must be exactly:

```csv
code,contestId,name,partyId,ballotNo,status
```

- Leave `ballotNo` blank until the official draw.
- Generate every new `code` with `createCandidateId` from `src/server/candidate-ids.ts`; it must be `{partyId}-{contestId}-{8 uppercase hex}`.
- Before handoff, run `parseCandidateCsv` and `prepareCandidateImport` from `src/server/candidate-import.ts`. Resolve invalid contests, duplicate names, or replacement conflicts before calling the CSV import-ready.
- For a header-only file, confirm that its one-line shape is correct. `parseCandidateCsv` intentionally rejects an empty import and must not be represented as a successful preview.
- Do not run `importCandidates`, apply migrations, or start/restart the development server unless explicitly asked.

## Avatars

For every new CSV row, find a current head-and-shoulders portrait. Prefer, in order: an official candidate or campaign profile, an official party page, a government profile, or Wikimedia Commons with an explicit reusable licence. Do not use news photographs as avatar assets.

Download permitted source images and generate `public/avatars/{code}.webp`. Use `scripts/avatars/build-avatars.py` with jobs shaped as `[{ code, name, url, licence, attribution, source_url }]`; it crops to the project portrait standard: a square showing the head and a little shoulder, with face height about 57% of the frame and face centre near 51% horizontal / 53% vertical. Use `public/avatars/KMT-TPE-EXECUTIVE-1-CB695EB0.webp` as the visual quality reference. Inspect every generated crop; manually adjust and regenerate any fallback or poorly framed result.

Append an auditable row to `public/avatars/sources.csv` with its existing schema and the source URL, licence, and attribution. If no permitted portrait can be found, keep the candidate row but report the avatar as pending; do not substitute a news photo.

## Handoff

Report the number of CSV rows, candidates already present, candidates skipped for insufficient area or party evidence, and avatars completed versus pending. Link the import CSV and any avatars that were added. State that registrations remain provisional until the election authority announces the final list.
