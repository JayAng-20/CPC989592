import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const priceData = require("./price-data.js");

function officialFixture({ date = "1150727", prices = [34, 32, 30.5] } = {}) {
  const [price98, price95, price92] = prices;
  return [
    {
      型別名稱: "汽柴油零售",
      產品編號: "113F 1209800",
      產品名稱: "98無鉛汽油",
      交貨地點: "中油自營站",
      計價單位: "元/ 公升",
      參考牌價_金額: price98,
      牌價生效日期: date,
    },
    {
      型別名稱: "汽柴油零售",
      產品編號: "113F 1209500",
      產品名稱: "95無鉛汽油",
      交貨地點: "中油自營站",
      計價單位: "元/ 公升",
      參考牌價_金額: price95,
      牌價生效日期: date,
    },
    {
      型別名稱: "汽柴油零售",
      產品編號: "113F 1209200",
      產品名稱: "92無鉛汽油",
      交貨地點: "中油自營站",
      計價單位: "元/ 公升",
      參考牌價_金額: price92,
      牌價生效日期: date,
    },
    {
      型別名稱: "汽柴油零售",
      產品名稱: "酒精汽油",
      交貨地點: "中油自營站",
      計價單位: "元/ 公升",
      參考牌價_金額: 32,
      牌價生效日期: date,
    },
    {
      型別名稱: "汽柴油零售",
      產品名稱: "超級柴油",
      交貨地點: "中油自營站",
      計價單位: "元/ 公升",
      參考牌價_金額: 29.3,
      牌價生效日期: date,
    },
  ];
}

test("民國日期會正確轉成西元日期，並拒絕不存在的日期", () => {
  assert.equal(priceData.parseOfficialDate("1150727"), "2026-07-27");
  assert.equal(priceData.parseOfficialDate("20260727"), "2026-07-27");
  assert.equal(priceData.parseOfficialDate("2026-07-27"), "2026-07-27");
  assert.throws(() => priceData.parseOfficialDate("1150230"), /不是有效日期/);
  assert.throws(() => priceData.parseOfficialDate("not-a-date"), /格式錯誤/);
});

test("官方 JSON 只篩選三種中油自營站汽油，並保留產品欄位", () => {
  const result = priceData.normalizeOfficialPayload(officialFixture(), "2026-08-06T15:54:03.000Z");

  assert.deepEqual(result.prices, { 98: 34, 95: 32, 92: 30.5 });
  assert.equal(result.effectiveDate, "2026-07-27");
  assert.equal(result.products["98"].productName, "98無鉛汽油");
  assert.equal(result.products["95"].unit, "元/ 公升");
  assert.equal(result.products["92"].deliveryLocation, "中油自營站");
  assert.equal(result.retrievedAt, "2026-08-06T15:54:03.000Z");
});

test("官方資料缺少汽油、混入錯誤單位或日期不一致時拒絕", () => {
  const missing = officialFixture().filter((item) => item["產品名稱"] !== "95無鉛汽油");
  assert.throws(() => priceData.normalizeOfficialPayload(missing), /95無鉛汽油/);

  const wrongUnit = officialFixture();
  wrongUnit[0]["計價單位"] = "元/ 公秉";
  assert.throws(() => priceData.normalizeOfficialPayload(wrongUnit), /98無鉛汽油/);

  const mixedDate = officialFixture();
  mixedDate[2]["牌價生效日期"] = "1150728";
  assert.throws(() => priceData.normalizeOfficialPayload(mixedDate), /生效日期不一致/);

  const invalidPrice = officialFixture();
  invalidPrice[1]["參考牌價_金額"] = 0;
  assert.throws(() => priceData.normalizeOfficialPayload(invalidPrice), /大於 0/);
});

test("資料檔驗證會確認三個價格與產品欄位一致", () => {
  const normalized = priceData.normalizeOfficialPayload(officialFixture(), "2026-08-06T15:54:03.000Z");
  assert.deepEqual(priceData.validatePriceData(normalized), normalized);

  const inconsistent = structuredClone(normalized);
  inconsistent.prices["95"] = 31.9;
  assert.throws(() => priceData.validatePriceData(inconsistent), /prices 與 products 牌價不一致/);
});

test("前端資料路徑維持相對路徑，並以牌價生效日作為版本參數", async () => {
  const path = priceData.buildDataUrl(priceData.DATA_PATH, "2026-07-27");
  assert.equal(path, "data/cpc-prices.json?version=2026-07-27");
  assert.ok(!path.startsWith("/"));

  let requestedUrl = "";
  let requestedOptions = null;
  const result = await priceData.loadPriceData({
    knownEffectiveDate: "2026-07-27",
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        async json() {
          const normalized = priceData.normalizeOfficialPayload(officialFixture(), "2026-08-06T15:54:03.000Z");
          return normalized;
        },
      };
    },
  });
  assert.equal(requestedUrl, "data/cpc-prices.json?version=2026-07-27");
  assert.equal(requestedOptions.cache, "no-store");
  assert.equal(result.prices["98"], 34);
});
