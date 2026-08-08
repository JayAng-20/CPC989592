import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { updatePriceFile } from "./update-cpc-prices.mjs";

function responseFrom(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}

function officialFixture({ date = "1150727", prices = [34, 32, 30.5] } = {}) {
  const [price98, price95, price92] = prices;
  return [
    ["98", price98],
    ["95", price95],
    ["92", price92],
  ].map(([grade, price]) => ({
    型別名稱: "汽柴油零售",
    產品編號: `113F 120${grade}00`,
    產品名稱: `${grade}無鉛汽油`,
    交貨地點: "中油自營站",
    計價單位: "元/ 公升",
    參考牌價_金額: price,
    牌價生效日期: date,
  }));
}

test("油價沒有變更時不寫入新 retrievedAt，也不要求建立 commit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpc-price-test-"));
  const dataFile = path.join(directory, "data", "cpc-prices.json");
  try {
    const first = await updatePriceFile({
      dataFile,
      now: new Date("2026-08-06T15:54:03.000Z"),
      fetchImpl: async () => responseFrom(officialFixture()),
    });
    const second = await updatePriceFile({
      dataFile,
      now: new Date("2026-08-06T16:54:03.000Z"),
      fetchImpl: async () => responseFrom(officialFixture()),
    });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    const saved = JSON.parse(await readFile(dataFile, "utf8"));
    assert.equal(saved.retrievedAt, "2026-08-06T15:54:03.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("官方牌價生效日期倒退時安全失敗，上一筆資料保持不變", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpc-price-test-"));
  const dataFile = path.join(directory, "data", "cpc-prices.json");
  try {
    await updatePriceFile({
      dataFile,
      now: new Date("2026-08-06T15:54:03.000Z"),
      fetchImpl: async () => responseFrom(officialFixture({ date: "1150727" })),
    });
    const before = await readFile(dataFile, "utf8");

    await assert.rejects(
      updatePriceFile({
        dataFile,
        now: new Date("2026-08-06T16:54:03.000Z"),
        fetchImpl: async () => responseFrom(officialFixture({ date: "1150726" })),
      }),
      /日期倒退/,
    );

    assert.equal(await readFile(dataFile, "utf8"), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("官方資料格式錯誤時不覆蓋既有資料", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpc-price-test-"));
  const dataFile = path.join(directory, "data", "cpc-prices.json");
  try {
    const valid = await updatePriceFile({
      dataFile,
      now: new Date("2026-08-06T15:54:03.000Z"),
      fetchImpl: async () => responseFrom(officialFixture()),
    });
    const before = await readFile(dataFile, "utf8");
    assert.equal(valid.changed, true);

    await assert.rejects(
      updatePriceFile({
        dataFile,
        fetchImpl: async () => responseFrom(officialFixture().slice(0, 2)),
      }),
      /92無鉛汽油/,
    );
    assert.equal(await readFile(dataFile, "utf8"), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
