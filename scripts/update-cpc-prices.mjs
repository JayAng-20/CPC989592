import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const priceData = require("../price-data.js");
const SCRIPT_FILE = fileURLToPath(import.meta.url);

export const OFFICIAL_URL = priceData.OFFICIAL_SOURCE_URL;
export const DATA_FILE = resolve(process.cwd(), "data/cpc-prices.json");

function comparableData(data) {
  const { retrievedAt: _retrievedAt, ...stableData } = data;
  return JSON.stringify(stableData);
}

async function readExistingData(dataFile) {
  try {
    const source = await readFile(dataFile, "utf8");
    return priceData.validatePriceData(JSON.parse(source));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    // A malformed old file may be replaced by a newly validated official payload.
    // A failed network request never reaches the write step, so the old file remains intact.
    return null;
  }
}

async function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
}

export async function fetchOfficialPayload(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("目前 Node.js 不支援 fetch，請使用 Node.js 20 或更新版本。" );
  }

  let response;
  try {
    response = await fetchImpl(OFFICIAL_URL, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(`連線台灣中油官方 JSON 失敗：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response || !response.ok) {
    throw new Error(`台灣中油官方 JSON 回應失敗（HTTP ${response && response.status ? response.status : "未知"}）。`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`台灣中油官方 JSON 無法解析：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function updatePriceFile({
  fetchImpl = globalThis.fetch,
  dataFile = DATA_FILE,
  now = new Date(),
} = {}) {
  const rawPayload = await fetchOfficialPayload(fetchImpl);
  const incoming = priceData.normalizeOfficialPayload(rawPayload, now);
  const existing = await readExistingData(dataFile);

  if (existing && existing.effectiveDate > incoming.effectiveDate) {
    throw new Error(
      `官方牌價生效日期倒退：現有 ${existing.effectiveDate}，新資料 ${incoming.effectiveDate}。為保留上一筆有效資料，本次更新已中止。`,
    );
  }

  if (existing && comparableData(existing) === comparableData(incoming)) {
    await writeOutput("changed", "false");
    return { changed: false, data: existing };
  }

  const serialized = `${JSON.stringify(incoming, null, 2)}\n`;
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, serialized, "utf8");
  await rename(temporaryFile, dataFile);
  await writeOutput("changed", "true");
  return { changed: true, data: incoming };
}

async function main() {
  const result = await updatePriceFile();
  if (result.changed) {
    console.log(`已更新 data/cpc-prices.json：牌價生效日 ${result.data.effectiveDate}，98／95／92 = ${result.data.prices[98]}／${result.data.prices[95]}／${result.data.prices[92]} 元／L。`);
  } else {
    console.log("官方油價與目前資料檔相同，未建立新資料或 commit。" );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_FILE)) {
  main().catch((error) => {
    console.error(`更新台灣中油油價失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
