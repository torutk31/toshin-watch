import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'fund-config.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'funds.json');
const BASE_URL = 'https://site0.sbisec.co.jp/marble/fund/history/standardprice.do';
const JST = 'Asia/Tokyo';

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
let previous = { funds: [] };
try {
  previous = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
} catch {
  // 初回実行時は空データから開始する。
}

function toJstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JST,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return parts;
}

function isoJst(date = new Date()) {
  const p = toJstParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

function dateParts(date) {
  return {
    yyyy: String(date.getUTCFullYear()),
    mm: String(date.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(date.getUTCDate()).padStart(2, '0')
  };
}

function japanDateToUtc(dateString) {
  return new Date(`${dateString.replaceAll('/', '-')}T00:00:00Z`);
}

function priorCalendarDate(currentDate, monthsBack) {
  const source = japanDateToUtc(currentDate);
  const targetYear = source.getUTCFullYear();
  const targetMonthIndex = source.getUTCMonth() - monthsBack;
  const first = new Date(Date.UTC(targetYear, targetMonthIndex, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(source.getUTCDate(), lastDay)));
}

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRows(html) {
  const tableStart = html.indexOf('年月日');
  const body = html.slice(tableStart).match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const rows = [];
  for (const rowHtml of body.match(/<tr>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...rowHtml.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map((match) => stripHtml(match[1]));
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(cells[0] ?? '')) continue;
    const value = Number((cells[1] ?? '').replace(/[^\d-]/g, ''));
    const dailyChange = Number((cells[2] ?? '').replace(/[^\d-]/g, ''));
    if (!Number.isFinite(value) || !Number.isFinite(dailyChange)) continue;
    rows.push({ date: cells[0], value, dailyChange });
  }
  return rows;
}

async function fetchSbi(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'toshin-watch-sample/1.0 (personal use)' },
    ...options
  });
  if (!response.ok) throw new Error(`SBI証券へのアクセスに失敗しました (${response.status})`);
  return new TextDecoder('shift_jis').decode(await response.arrayBuffer());
}

async function fetchLatest(fundSecCode) {
  const url = `${BASE_URL}?fund_sec_code=${encodeURIComponent(fundSecCode)}`;
  const rows = parseRows(await fetchSbi(url));
  if (!rows.length) throw new Error('直近基準価額を読み取れませんでした');
  return rows[0];
}

async function fetchReferenceOnOrBefore(fundSecCode, targetDate) {
  const from = new Date(targetDate);
  from.setUTCDate(from.getUTCDate() - 10);
  const fromParts = dateParts(from);
  const toParts = dateParts(targetDate);
  const form = new URLSearchParams({
    in_term_from_yyyy: fromParts.yyyy,
    in_term_from_mm: fromParts.mm,
    in_term_from_dd: fromParts.dd,
    in_term_to_yyyy: toParts.yyyy,
    in_term_to_mm: toParts.mm,
    in_term_to_dd: toParts.dd,
    dispRows: '100',
    page: '0',
    fund_sec_code: fundSecCode
  });
  const url = `${BASE_URL}?fund_sec_code=${encodeURIComponent(fundSecCode)}`;
  const rows = parseRows(await fetchSbi(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'toshin-watch-sample/1.0 (personal use)'
    },
    body: form
  }));
  const target = targetDate.toISOString().slice(0, 10).replaceAll('-', '/');
  return rows.find((row) => row.date <= target) ?? null;
}

function comparison(latest, reference) {
  if (!reference) return null;
  const change = latest.value - reference.value;
  return {
    change,
    percent: Number(((change / reference.value) * 100).toFixed(2)),
    referenceDate: reference.date,
    referenceValue: reference.value
  };
}

function sbiHistoryUrl(fundSecCode) {
  return `${BASE_URL}?fund_sec_code=${encodeURIComponent(fundSecCode)}`;
}

async function updateFund(fund) {
  const latest = await fetchLatest(fund.fundSecCode);
  const monthTarget = priorCalendarDate(latest.date, 1);
  const yearTarget = priorCalendarDate(latest.date, 12);
  const [monthReference, yearReference] = await Promise.all([
    fetchReferenceOnOrBefore(fund.fundSecCode, monthTarget),
    fetchReferenceOnOrBefore(fund.fundSecCode, yearTarget)
  ]);
  return {
    ...fund,
    status: 'ok',
    latest: {
      date: latest.date,
      value: latest.value,
      dailyChange: latest.dailyChange,
      dailyPercent: Number(((latest.dailyChange / (latest.value - latest.dailyChange)) * 100).toFixed(2))
    },
    monthComparison: comparison(latest, monthReference),
    yearComparison: comparison(latest, yearReference),
    links: {
      detail: sbiHistoryUrl(fund.fundSecCode),
      chart: sbiHistoryUrl(fund.fundSecCode)
    },
    source: {
      name: 'SBI証券 投資信託 基準価額',
      url: sbiHistoryUrl(fund.fundSecCode)
    }
  };
}

const results = await Promise.allSettled(config.map(updateFund));
const priorById = new Map((previous.funds ?? []).map((fund) => [fund.id, fund]));
const funds = results.map((result, index) => {
  if (result.status === 'fulfilled') return result.value;
  const fund = config[index];
  const old = priorById.get(fund.id);
  return {
    ...(old ?? fund),
    status: 'stale',
    updateError: result.reason?.message ?? '不明な更新エラー',
    links: old?.links ?? { detail: sbiHistoryUrl(fund.fundSecCode), chart: sbiHistoryUrl(fund.fundSecCode) },
    source: old?.source ?? { name: 'SBI証券 投資信託 基準価額', url: sbiHistoryUrl(fund.fundSecCode) }
  };
});

const failed = results.filter((result) => result.status === 'rejected');
const output = {
  generatedAt: isoJst(),
  timezone: JST,
  source: {
    name: 'SBI証券 投資信託 基準価額',
    note: '基準価額・前日比・純資産総額はSBI証券ページ内でウエルスアドバイザー社提供と表示されています。前月・前年は同日の基準価額がない場合、その直前の掲載日を比較対象とします。'
  },
  funds
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`更新完了: ${funds.length - failed.length}/${funds.length} 本 (${output.generatedAt})`);
if (failed.length) {
  for (const result of failed) console.error(`更新失敗: ${result.reason?.message ?? result.reason}`);
  process.exitCode = 1;
}
