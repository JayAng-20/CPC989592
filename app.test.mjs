import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  calculator,
  priceData,
  roundingCalculator: rounding,
  runtimePrices,
  updatePriceFile,
  createLocalServer,
} = require("./app.js");


const defaultConfig = { ...calculator.DEFAULT_CONFIG };
const defaultPrices = { ...calculator.DEFAULT_PRICES };

function close(actual, expected, epsilon = 1e-6) {
  assert.ok(Number.isFinite(actual), `預期有限數字，實際為 ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} 與預期 ${expected} 的差超過 ${epsilon}`,
  );
}

function methodById(fuel, id) {
  return fuel.methods.find((method) => method.id === id);
}

test("預設共同參數：中信紅利、捷利卡紅利與 VIP 點數皆正確", () => {
  const fuel = calculator.calculateFuel(34, defaultConfig, "98");
  const method1 = methodById(fuel, 1);
  const method2 = methodById(fuel, 2);
  const method3 = methodById(fuel, 3);
  const method5 = methodById(fuel, 5);
  const method6 = methodById(fuel, 6);

  assert.equal(method1.ctbcPoints, 300);
  close(method1.ctbcValue, 24);
  close(method1.jieliBalance, 3120);
  close(method1.jieliBonus, 120);
  assert.equal(method2.vipPoints, 6240);
  assert.equal(method3.vipPoints, 6240);
  assert.equal(method5.vipPoints, 6000);
  assert.equal(method6.vipPoints, 6000);
  close(method2.vipValue, 62.4);
  close(method3.vipValue, 31.2);
  close(method5.vipValue, 60);
  close(method6.vipValue, 30);
  assert.equal(method1.vipPoints, 0);
  assert.equal(methodById(fuel, 4).vipPoints, 0);
});

test("98、95、92 預設案例通過所有指定總回饋與精確回饋率", () => {
  const expected = {
    98: [
      [219.18072289156626, 7.306024096385542],
      [206.4, 6.88],
      [175.2, 5.84],
      [96.28915662650603, 3.2096385542168675],
      [84, 2.8],
      [54, 1.8],
    ],
    95: [
      [224, 7.466666666666668],
      [206.4, 6.88],
      [175.2, 5.84],
      [100.92307692307693, 3.3641025641025646],
      [84, 2.8],
      [54, 1.8],
    ],
    92: [
      [228.04040404040404, 7.601346801346802],
      [206.4, 6.88],
      [175.2, 5.84],
      [104.80808080808082, 3.493602693602694],
      [84, 2.8],
      [54, 1.8],
    ],
  };

  const all = calculator.calculateAll(defaultPrices, defaultConfig);
  for (const grade of ["98", "95", "92"]) {
    assert.deepEqual(
      all.fuels[grade].ranking.map((method) => method.id),
      [1, 2, 3, 4, 5, 6],
    );
    expected[grade].forEach(([totalReward, preciseRate], index) => {
      const method = methodById(all.fuels[grade], index + 1);
      close(method.totalReward, totalReward);
      close(method.preciseRate, preciseRate);
    });
  }
});

test("98 無鉛方法 1 的公升、廣告式率、率差與有效成本保留完整精度", () => {
  const method = methodById(calculator.calculateFuel(34, defaultConfig, "98"), 1);
  close(method.liters, 93.97590361445782);
  close(method.selfServiceSavings, 75.18072289156626);
  close(method.advertisedRate, 7.152941176470589);
  close(method.rateDifference, 0.1530829199149535);
  close(method.effectiveCostPerLiter, 31.667692307692313);
  close(method.totalEquivalent, 3219.1807228915663);
});

test("每個方案皆符合共同不變量，自助方案也通過替代公式交叉驗證", () => {
  const all = calculator.calculateAll(defaultPrices, defaultConfig);
  for (const grade of ["98", "95", "92"]) {
    const fuel = all.fuels[grade];
    for (const method of fuel.methods) {
      close(
        method.totalReward,
        method.jieliBonus +
          method.selfServiceSavings +
          method.ctbcValue +
          method.vipValue,
        1e-9,
      );
      close(method.preciseRate, (method.totalReward / defaultConfig.principal) * 100, 1e-9);
      close(method.rateDifference, method.preciseRate - method.advertisedRate, 1e-9);
      close(method.totalEquivalent, defaultConfig.principal + method.totalReward, 1e-9);
      close(
        method.effectiveCostPerLiter * method.liters,
        defaultConfig.principal - method.ctbcValue - method.vipValue,
        1e-9,
      );
      close(
        method.liters * method.actualUnitPrice,
        method.usesRecharge ? 3120 : 3000,
        1e-9,
      );

      if (method.serviceMode === "自助") {
        close(method.totalReward, fuel.price * method.liters + method.ctbcValue - 3000, 1e-9);
        close(method.crossCheckTotal, method.totalReward, 1e-9);
        close(method.crossCheckDifference, 0, 1e-9);
      } else {
        assert.equal(method.crossCheckTotal, null);
      }
    }
  }
});

test("自助折扣分析使用 d/P 與 d/U 兩個不同分母", () => {
  const expected = {
    98: [33.2, 2.3529411764705883, 2.4096385542168672],
    95: [31.2, 2.5, 2.5641025641025643],
    92: [29.7, 2.622950819672131, 2.693602693602694],
  };
  const all = calculator.calculateAll(defaultPrices, defaultConfig);
  for (const grade of ["98", "95", "92"]) {
    const fuel = all.fuels[grade];
    close(fuel.selfServicePrice, expected[grade][0]);
    close(fuel.advertisedDiscountRate, expected[grade][1]);
    close(fuel.extraPurchasingPower, expected[grade][2]);
    assert.ok(fuel.extraPurchasingPower > fuel.advertisedDiscountRate);
  }
  assert.ok(all.fuels[92].advertisedDiscountRate > all.fuels[98].advertisedDiscountRate);
});

test("白金卡按每滿 30 元 2 點重算六種方法", () => {
  const config = { ...defaultConfig, cardType: calculator.CARD_TYPES.PLATINUM };
  const fuel = calculator.calculateFuel(34, config, "98");
  const expectedTotals = [211.18072289156626, 198.4, 167.2, 88.28915662650603, 76, 46];

  fuel.methods.forEach((method, index) => {
    assert.equal(method.ctbcPoints, 200);
    close(method.ctbcValue, 16);
    close(method.totalReward, expectedTotals[index]);
  });
  assert.deepEqual(fuel.ranking.map((method) => method.id), [1, 2, 3, 4, 5, 6]);
});

test("中信紅利與 VIP 點數均在正確位置 floor，不以近似百分比取代", () => {
  const signature3029 = calculator.calculateFuel(34, { ...defaultConfig, principal: 3029 }, "98");
  const platinum3029 = calculator.calculateFuel(
    34,
    { ...defaultConfig, principal: 3029, cardType: calculator.CARD_TYPES.PLATINUM },
    "98",
  );
  const signature3030 = calculator.calculateFuel(34, { ...defaultConfig, principal: 3030 }, "98");
  assert.equal(methodById(signature3029, 1).ctbcPoints, 300);
  assert.equal(methodById(platinum3029, 1).ctbcPoints, 200);
  assert.equal(methodById(signature3030, 1).ctbcPoints, 303);

  const fractionalBalance = calculator.calculateFuel(
    34,
    { ...defaultConfig, rechargeRate: 0.0402 },
    "98",
  );
  close(methodById(fractionalBalance, 2).jieliBalance, 3120.6);
  assert.equal(methodById(fractionalBalance, 2).vipPoints, 6240);
});

test("油價 45 元時人工購買副產品方案會超越相對應自助方案並動態重排", () => {
  const fuel = calculator.calculateFuel(45, defaultConfig, "自訂");
  assert.deepEqual(fuel.ranking.map((method) => method.id), [2, 1, 3, 5, 4, 6]);
  close(methodById(fuel, 1).totalReward, 200.47058823529412);
  close(methodById(fuel, 2).totalReward, 206.4);
  close(methodById(fuel, 4).totalReward, 78.29864253393666);
  close(methodById(fuel, 5).totalReward, 84);
  assert.ok(methodById(fuel, 2).preciseRate > methodById(fuel, 1).preciseRate);
  assert.ok(methodById(fuel, 5).preciseRate > methodById(fuel, 4).preciseRate);
});

test("理論同值時以方法編號穩定排序，差距小於 0.001 個百分點標示幾乎相同", () => {
  const atBreakEven = calculator.calculateFuel(40.8, defaultConfig, "自訂");
  close(methodById(atBreakEven, 1).totalReward, methodById(atBreakEven, 2).totalReward, 1e-9);
  close(methodById(atBreakEven, 4).totalReward, methodById(atBreakEven, 5).totalReward, 1e-9);
  assert.ok(atBreakEven.ranking.indexOf(atBreakEven.ranking.find((method) => method.id === 1)) < atBreakEven.ranking.indexOf(atBreakEven.ranking.find((method) => method.id === 2)));

  const nearBreakEven = calculator.calculateFuel(40.8001, defaultConfig, "自訂");
  assert.deepEqual(nearBreakEven.ranking.slice(0, 2).map((method) => method.id), [2, 1]);
  assert.equal(nearBreakEven.ranking[0].almostTieWithNext, true);
  assert.equal(nearBreakEven.ranking[1].almostTieWithPrevious, true);
  assert.ok(
    Math.abs(nearBreakEven.ranking[0].preciseRate - nearBreakEven.ranking[1].preciseRate) < 0.001,
  );
});

test("四組損益兩平價由目前參數求解，並以殘差驗證", () => {
  const all = calculator.calculateAll(defaultPrices, defaultConfig);
  const expected = [40.8, 80.8, 40.8, 80.8];
  all.breakEven.forEach((item, index) => {
    close(item.price, expected[index]);
    close(item.residual, 0, 1e-12);
  });

  const discountOne = calculator.calculateAll(defaultPrices, {
    ...defaultConfig,
    selfServiceDiscount: 1,
  });
  [51, 101, 51, 101].forEach((value, index) => close(discountOne.breakEven[index].price, value));

  const fractionalRecharge = calculator.calculateAll(defaultPrices, {
    ...defaultConfig,
    rechargeRate: 0.0402,
  });
  const fractionalExpected = [40.80769230769231, 80.81538461538462, 40.8, 80.8];
  fractionalExpected.forEach((value, index) =>
    close(fractionalRecharge.breakEven[index].price, value),
  );
});

test("自助折扣或 VIP 估值為 0 時損益兩平分析回報沒有有限交點", () => {
  const noDiscount = calculator.calculateBreakEven(
    { ...defaultConfig, selfServiceDiscount: 0 },
    "direct",
    "premium",
  );
  const noVipValue = calculator.calculateBreakEven(
    { ...defaultConfig, vipPremiumPointValue: 0 },
    "direct",
    "premium",
  );
  assert.equal(noDiscount.price, null);
  assert.match(noDiscount.reason, /沒有有限/);
  assert.equal(noVipValue.price, null);
  assert.match(noVipValue.reason, /沒有有限/);
});

test("純函式接受 HTML 表單常見的數字字串，不發生字串串接", () => {
  const stringConfig = Object.fromEntries(
    Object.entries(defaultConfig).map(([key, value]) => [key, key === "cardType" ? value : String(value)]),
  );
  const stringPrices = Object.fromEntries(
    Object.entries(defaultPrices).map(([key, value]) => [key, String(value)]),
  );
  const numeric = calculator.calculateAll(defaultPrices, defaultConfig);
  const fromStrings = calculator.calculateAll(stringPrices, stringConfig);
  close(fromStrings.fuels[98].winner.totalReward, numeric.fuels[98].winner.totalReward, 1e-12);
  fromStrings.breakEven.forEach((item, index) => close(item.price, numeric.breakEven[index].price, 1e-12));
});

test("空白、零、負數、非數字、Infinity 與牌價不高於折扣皆拒絕", () => {
  const invalidValues = ["", "   ", 0, -1, "abc", "34abc", Number.NaN, Number.POSITIVE_INFINITY];
  invalidValues.forEach((value) => {
    assert.equal(calculator.validateFuelPrice(value, 0.8, "98").valid, false, String(value));
  });
  assert.equal(calculator.validateFuelPrice(0.8, 0.8, "98").valid, false);
  assert.equal(calculator.validateFuelPrice(0.7, 0.8, "98").valid, false);
  assert.equal(calculator.validateFuelPrice(0.800001, 0.8, "98").valid, true);
  assert.throws(() => calculator.calculateFuel(0.8, defaultConfig, "98"), RangeError);
});

test("進階設定驗證與星期一活動門檻警告正確", () => {
  assert.equal(calculator.validateConfiguration({ ...defaultConfig, principal: 0 }).valid, false);
  assert.equal(calculator.validateConfiguration({ ...defaultConfig, rechargeRate: -0.01 }).valid, false);
  assert.equal(calculator.validateConfiguration({ ...defaultConfig, ctbcPointValue: -1 }).valid, false);
  assert.equal(calculator.validateConfiguration({ ...defaultConfig, cardType: "other" }).valid, false);
  assert.equal(calculator.validateConfiguration({ ...defaultConfig, vipFuelPointValue: 0 }).valid, true);

  const warning = "目前設定可能不符合星期一4%儲值活動門檻";
  assert.deepEqual(calculator.getActivityWarnings({ principal: 2500 }), [warning]);
  assert.deepEqual(calculator.getActivityWarnings({ principal: 3250 }), [warning]);
  assert.deepEqual(calculator.getActivityWarnings({ principal: 3000 }), []);
  assert.deepEqual(calculator.getActivityWarnings({ principal: 3500 }), []);
});

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("localStorage 設定可儲存、讀取、合併缺省欄位與清除", () => {
  const storage = new MemoryStorage();
  const state = calculator.getDefaultState();
  state.prices[98] = 35.1;
  state.config.cardType = calculator.CARD_TYPES.PLATINUM;

  assert.equal(calculator.savePreferences(storage, state), true);
  const raw = JSON.parse(storage.getItem(calculator.STORAGE_KEY));
  assert.equal(raw.version, 1);
  assert.deepEqual(calculator.loadPreferences(storage), state);

  storage.setItem(
    calculator.STORAGE_KEY,
    JSON.stringify({ version: 1, prices: { 98: 36 }, config: { principal: 3500 } }),
  );
  const partial = calculator.loadPreferences(storage);
  assert.equal(partial.prices[98], 36);
  assert.equal(partial.prices[95], calculator.DEFAULT_PRICES[95]);
  assert.equal(partial.config.principal, 3500);
  assert.equal(partial.config.cardType, calculator.DEFAULT_CONFIG.cardType);

  assert.equal(calculator.clearPreferences(storage), true);
  assert.equal(calculator.loadPreferences(storage), null);
});

test("官方同步 metadata 可加入既有 localStorage 並保留進階設定", () => {
  const storage = new MemoryStorage();
  const state = calculator.getDefaultState();
  state.prices = { 98: 35.4, 95: 33.2, 92: 31.7 };
  state.config.principal = 3500;
  state.priceMeta = {
    source: "台灣中油政府資料開放平台",
    sourceUrl: "https://vipmbr.cpc.com.tw/opendata/MainProdListPrice",
    effectiveDate: "2026-07-27",
    retrievedAt: "2026-08-06T15:54:03.000Z",
  };

  assert.equal(calculator.savePreferences(storage, state), true);
  const loaded = calculator.loadPreferences(storage);
  assert.deepEqual(loaded.prices, state.prices);
  assert.equal(loaded.config.principal, 3500);
  assert.deepEqual(loaded.priceMeta, state.priceMeta);
});

test("第二頁共用設定只接受完整油價與自助優惠，不會用預設值補猜", () => {
  const storage = new MemoryStorage();
  assert.equal(calculator.loadSharedFuelState(storage), null);

  storage.setItem(
    calculator.STORAGE_KEY,
    JSON.stringify({ version: 1, prices: { 98: 36 }, config: { selfServiceDiscount: 0.8 } }),
  );
  assert.equal(calculator.loadSharedFuelState(storage), null);

  const state = calculator.getDefaultState();
  state.prices = { 98: 35.1, 95: 33.2, 92: 31.7 };
  assert.equal(calculator.savePreferences(storage, state), true);
  assert.deepEqual(calculator.loadSharedFuelState(storage), state);

  const raw = JSON.parse(storage.getItem(calculator.STORAGE_KEY));
  delete raw.config.selfServiceDiscount;
  storage.setItem(calculator.STORAGE_KEY, JSON.stringify(raw));
  assert.equal(calculator.loadSharedFuelState(storage), null);

  for (const invalidDiscount of [null, true, false, "", "   "]) {
    const invalidState = calculator.getDefaultState();
    const payload = { version: 1, prices: invalidState.prices, config: invalidState.config };
    payload.config.selfServiceDiscount = invalidDiscount;
    storage.setItem(calculator.STORAGE_KEY, JSON.stringify(payload));
    assert.equal(calculator.loadSharedFuelState(storage), null);
  }

  for (const invalidPrice of [null, true, false, "", "   "]) {
    const invalidState = calculator.getDefaultState();
    const payload = { version: 1, prices: invalidState.prices, config: invalidState.config };
    payload.prices[98] = invalidPrice;
    storage.setItem(calculator.STORAGE_KEY, JSON.stringify(payload));
    assert.equal(calculator.loadSharedFuelState(storage), null);
  }
});

test("人工與自助有效單價共用同一條 P−d 規則", () => {
  assert.equal(calculator.calculateEffectiveUnitPrice(32, 0.8, "manual"), 32);
  close(calculator.calculateEffectiveUnitPrice(32, 0.8, "self-service"), 31.2);
  assert.throws(
    () => calculator.calculateEffectiveUnitPrice(0.8, 0.8, "self-service"),
    /必須大於 0/,
  );
});

test("localStorage 損壞資料、舊版本、非法值或瀏覽器拒絕存取時安全回退", () => {
  const storage = new MemoryStorage();
  storage.setItem(calculator.STORAGE_KEY, "{broken json");
  assert.equal(calculator.loadPreferences(storage), null);

  storage.setItem(calculator.STORAGE_KEY, JSON.stringify({ version: 0 }));
  assert.equal(calculator.loadPreferences(storage), null);

  storage.setItem(
    calculator.STORAGE_KEY,
    JSON.stringify({
      version: 1,
      prices: { ...defaultPrices, 98: 0 },
      config: defaultConfig,
    }),
  );
  assert.equal(calculator.loadPreferences(storage), null);

  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(calculator.loadPreferences(throwingStorage), null);
  assert.equal(calculator.loadSharedFuelState(throwingStorage), null);
  assert.equal(calculator.savePreferences(throwingStorage, calculator.getDefaultState()), false);
  assert.equal(calculator.clearPreferences(throwingStorage), false);
});


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


const prices = { 98: 34, 95: 32, 92: 30.5 };
const baseInput = {
  prices,
  grade: "95",
  mode: rounding.MODES.MANUAL,
  selfServiceDiscount: 0.8,
  stopVolume: "10.00",
};

function search(overrides = {}) {
  return rounding.findCandidates({ ...baseInput, ...overrides });
}

test("T1：搜尋只往上，不包含跳停值本身或更低公升數", () => {
  const result = search();
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) {
    assert.ok(Number(candidate.targetVolume) > 10);
    assert.ok(Number(candidate.additionalVolume) > 0);
  }
  assert.equal(result.candidates.some((candidate) => candidate.targetVolume === "10.00"), false);
});

test("T2：兩組各五筆、總數最多十筆，接近上限時保留各組實際數量", () => {
  const normal = search();
  assert.equal(normal.candidates.length, 10);
  assert.deepEqual(normal.categoryCounts, { range: 5, exactPointFour: 5 });
  assert.equal(normal.resultLimitReached, true);

  const nearLimit = search({ stopVolume: "93.00" });
  assert.deepEqual(
    nearLimit.candidates.map((candidate) => candidate.targetVolume),
    ["93.01", "93.20", "93.23", "93.26", "93.45", "93.48", "93.51", "93.70"],
  );
  assert.deepEqual(nearLimit.categoryCounts, { range: 5, exactPointFour: 3 });
  assert.equal(nearLimit.candidates.length, 8);
  assert.equal(nearLimit.candidates.some((candidate) => candidate.targetVolume === "93.73"), false);
  assert.equal(nearLimit.amountLimitReached, true);
  assert.equal(search({ limit: 4 }).candidates.length, 8);
  assert.deepEqual(search({ limit: 4 }).categoryCounts, { range: 4, exactPointFour: 4 });
  assert.ok(normal.candidates.length <= 10);
  assert.equal(rounding.validateSearchInput({ ...baseInput, limit: 6 }).valid, false);
  assert.throws(() => search({ limit: 6 }), RangeError);
});

test("T2：其中一組不足時不以另一組第六筆補足", () => {
  const exactOnly = search({
    prices: { 98: 20, 95: 20, 92: 20 },
  });
  assert.deepEqual(exactOnly.categoryCounts, { range: 0, exactPointFour: 5 });
  assert.equal(exactOnly.candidates.length, 5);
  assert.ok(exactOnly.candidates.every((candidate) => candidate.category === rounding.CATEGORIES.EXACT_POINT_FOUR));

  const rangeOnly = search({
    prices: { 98: 12.5, 95: 12.5, 92: 12.5 },
  });
  assert.deepEqual(rangeOnly.categoryCounts, { range: 5, exactPointFour: 0 });
  assert.equal(rangeOnly.candidates.length, 5);
  assert.ok(rangeOnly.candidates.every((candidate) => candidate.category === rounding.CATEGORIES.RANGE));
});

test("T3：結果依目標公升與增加量嚴格遞增", () => {
  const result = search();
  for (let index = 1; index < result.candidates.length; index += 1) {
    const previous = result.candidates[index - 1];
    const current = result.candidates[index];
    assert.ok(BigInt(current.targetVolumeHundredths) > BigInt(previous.targetVolumeHundredths));
    assert.ok(BigInt(current.additionalVolumeHundredths) > BigInt(previous.additionalVolumeHundredths));
    assert.equal(current.rank, index + 1);
    assert.equal(
      Number((Number(current.targetVolume) - Number(result.stopVolume)).toFixed(2)),
      Number(current.additionalVolume),
    );
  }
  assert.equal(new Set(result.candidates.map((candidate) => candidate.targetVolume)).size, result.candidates.length);
});

test("T4：以 fixed-point 將 .300～未滿 .400 與精確 .400 分成互斥兩組", () => {
  const cases = [
    ["320.299", null, 320n],
    ["320.300", rounding.CATEGORIES.RANGE, 320n],
    ["320.301", rounding.CATEGORIES.RANGE, 320n],
    ["320.399", rounding.CATEGORIES.RANGE, 320n],
    ["320.4", rounding.CATEGORIES.EXACT_POINT_FOUR, 320n],
    ["320.40", rounding.CATEGORIES.EXACT_POINT_FOUR, 320n],
    ["320.400", rounding.CATEGORIES.EXACT_POINT_FOUR, 320n],
    ["320.4000", rounding.CATEGORIES.EXACT_POINT_FOUR, 320n],
    ["320.401", null, 320n],
    ["320.410", null, 320n],
    ["320.499", null, 320n],
    ["320.500", null, 321n],
    ["320.000", null, 320n],
  ];
  for (const [amount, category, roundedAmount] of cases) {
    const classification = rounding.classifyUnroundedAmount(amount);
    assert.equal(classification.category, category);
    assert.equal(classification.qualifies, category !== null);
    assert.equal(classification.isRangeCandidate, category === rounding.CATEGORIES.RANGE);
    assert.equal(
      classification.isExactPointFourCandidate,
      category === rounding.CATEGORIES.EXACT_POINT_FOUR,
    );
    assert.equal(classification.roundedAmount, roundedAmount);
  }

  const actualSearch = search({ prices: { ...prices, 95: 10 } });
  assert.ok(actualSearch.candidates.some((candidate) => candidate.rawAmount === "100.300"));
  assert.ok(actualSearch.candidates.some((candidate) => candidate.rawAmount === "100.400"));
  assert.equal(actualSearch.candidates.some((candidate) => candidate.rawAmount === "100.500"), false);
  for (const candidate of actualSearch.candidates) {
    assert.equal(rounding.classifyUnroundedAmount(candidate.rawAmount).category, candidate.category);
  }
});

test("T5：人工模式直接使用人工油價乘以候選公升數", () => {
  const first = search().candidates[0];
  assert.equal(first.targetVolume, "10.01");
  assert.equal(first.category, rounding.CATEGORIES.RANGE);
  assert.equal(first.rawAmount, "320.320");
  assert.equal(first.roundedAmount, "320");
  assert.equal(search().effectiveUnitPrice, "32.0");
});

test("T6：自助模式直接以精確自助有效單價乘以公升數，沒有重複折扣或二次進位", () => {
  const result = search({ mode: rounding.MODES.SELF_SERVICE });
  assert.equal(result.manualUnitPrice, "32.0");
  assert.equal(result.selfServiceDiscount, "0.8");
  assert.equal(result.effectiveUnitPrice, "31.2");
  assert.equal(result.candidates[0].targetVolume, "10.01");
  assert.equal(result.candidates[0].category, rounding.CATEGORIES.RANGE);
  assert.equal(result.candidates[0].rawAmount, "312.312");
  assert.equal(result.candidates[0].roundedAmount, "312");
  assert.deepEqual(result.categoryCounts, { range: 5, exactPointFour: 5 });

  const exactMultiDecimal = search({
    prices: { ...prices, 95: 32.05 },
    mode: rounding.MODES.SELF_SERVICE,
  });
  assert.equal(exactMultiDecimal.effectiveUnitPrice, "31.25");
  const exactPrice = rounding.resolveEffectiveUnitPrice({
    prices: { ...prices, 95: 32.05 },
    grade: "95",
    mode: rounding.MODES.SELF_SERVICE,
    selfServiceDiscount: 0.8,
  });
  assert.equal(rounding.analyzeAmount(exactPrice.effective, 1001n).rawAmount, "312.8125");
});

test("T7：98、95、92 切換後使用各自正確牌價與自助價", () => {
  const expected = {
    98: ["34.0", "340.340", "33.2"],
    95: ["32.0", "320.320", "31.2"],
    92: ["30.5", "305.305", "29.7"],
  };

  for (const grade of rounding.GRADES) {
    const manual = search({ grade });
    const selfService = search({ grade, mode: rounding.MODES.SELF_SERVICE });
    assert.equal(manual.effectiveUnitPrice, expected[grade][0]);
    assert.equal(manual.candidates[0].rawAmount, expected[grade][1]);
    assert.equal(selfService.effectiveUnitPrice, expected[grade][2]);
    assert.deepEqual(manual.categoryCounts, { range: 5, exactPointFour: 5 });
    assert.deepEqual(selfService.categoryCounts, { range: 5, exactPointFour: 5 });
    assert.ok(manual.candidates.every((candidate) => rounding.classifyUnroundedAmount(candidate.rawAmount).category === candidate.category));
    assert.ok(selfService.candidates.every((candidate) => rounding.classifyUnroundedAmount(candidate.rawAmount).category === candidate.category));
  }
});

test("T8：32.0 元與 10.00 L 固定案例合併兩組並精確排序十筆", () => {
  const result = search();
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.rank,
      candidate.targetVolume,
      candidate.category,
      candidate.rawAmount,
    ]),
    [
      [1, "10.01", rounding.CATEGORIES.RANGE, "320.320"],
      [2, "10.20", rounding.CATEGORIES.EXACT_POINT_FOUR, "326.400"],
      [3, "10.23", rounding.CATEGORIES.RANGE, "327.360"],
      [4, "10.26", rounding.CATEGORIES.RANGE, "328.320"],
      [5, "10.45", rounding.CATEGORIES.EXACT_POINT_FOUR, "334.400"],
      [6, "10.48", rounding.CATEGORIES.RANGE, "335.360"],
      [7, "10.51", rounding.CATEGORIES.RANGE, "336.320"],
      [8, "10.70", rounding.CATEGORIES.EXACT_POINT_FOUR, "342.400"],
      [9, "10.95", rounding.CATEGORIES.EXACT_POINT_FOUR, "350.400"],
      [10, "11.20", rounding.CATEGORIES.EXACT_POINT_FOUR, "358.400"],
    ],
  );
  assert.deepEqual(
    result.candidates
      .filter((candidate) => rounding.isExactPointFourCandidate(candidate))
      .map((candidate) => candidate.rank),
    [2, 5, 8, 9, 10],
  );
  assert.ok(
    result.candidates
      .filter((candidate) => candidate.category === rounding.CATEGORIES.RANGE)
      .every((candidate) => !rounding.isExactPointFourCandidate(candidate)),
  );
});

test("T9：只納入 NT$20～NT$3,000，並在上限停止", () => {
  const lowerBoundary = search({
    prices: { ...prices, 95: 20 },
    stopVolume: "0.01",
  });
  assert.equal(lowerBoundary.candidates[0].targetVolume, "1.02");
  assert.equal(lowerBoundary.candidates[0].rawAmount, "20.400");
  assert.ok(lowerBoundary.candidates.every((candidate) => Number(candidate.rawAmount) >= 20));

  const upperBoundary = search({
    prices: { ...prices, 95: 30 },
    stopVolume: "99.97",
  });
  assert.deepEqual(upperBoundary.candidates.map((candidate) => candidate.rawAmount), ["2999.400"]);
  assert.ok(upperBoundary.candidates.every((candidate) => Number(candidate.rawAmount) <= 3000));
  assert.equal(upperBoundary.reason, "amount-limit");

  const aboveBoundary = search({
    prices: { ...prices, 95: 30 },
    stopVolume: "100.01",
  });
  assert.deepEqual(aboveBoundary.candidates, []);
  assert.equal(aboveBoundary.reason, "above-maximum");
  assert.equal(aboveBoundary.amountLimitReached, true);
});

test("T10：跳停公升數拒絕空值、非正數、非數字、無限值及超過兩位小數", () => {
  const invalidVolumes = ["", "   ", 0, "0.00", -1, "-1.00", "abc", "NaN", "Infinity", Number.NaN, Number.POSITIVE_INFINITY, "10.001"];
  for (const stopVolume of invalidVolumes) {
    const validation = rounding.validateSearchInput({ ...baseInput, stopVolume });
    assert.equal(validation.valid, false, `應拒絕 ${String(stopVolume)}`);
    assert.throws(() => search({ stopVolume }), RangeError);
  }
});

test("T10：拒絕不存在的油品、模式與非正自助有效單價", () => {
  const invalidInputs = [
    { grade: "91" },
    { mode: "other" },
    { prices: { ...prices, 95: 0 } },
    { prices: { ...prices, 95: "abc" } },
    { prices: { ...prices, 95: 0.8 }, mode: rounding.MODES.SELF_SERVICE },
    { prices: { ...prices, 95: 0.7 }, mode: rounding.MODES.SELF_SERVICE },
    { selfServiceDiscount: -0.1, mode: rounding.MODES.SELF_SERVICE },
  ];
  for (const invalid of invalidInputs) {
    assert.equal(rounding.validateSearchInput({ ...baseInput, ...invalid }).valid, false);
    assert.throws(() => search(invalid), RangeError);
  }
});

class RoundingMemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("T11：兩頁共用既有 localStorage key，清除後第二頁嚴格讀取為空", () => {
  const storage = new RoundingMemoryStorage();
  const state = calculator.getDefaultState();
  state.prices = { 98: 35.3, 95: 33.1, 92: 31.6 };

  assert.equal(calculator.savePreferences(storage, state), true);
  assert.deepEqual(calculator.loadSharedFuelState(storage).prices, state.prices);
  assert.deepEqual([...storage.values.keys()], [calculator.STORAGE_KEY]);

  calculator.clearPreferences(storage);
  assert.equal(calculator.loadSharedFuelState(storage), null);
});

test("極小自助有效單價會精確跳過不合格區間，不會在 NT$3,000 前提早停止", () => {
  const result = search({
    prices: { ...prices, 95: 0.8000001 },
    mode: rounding.MODES.SELF_SERVICE,
    selfServiceDiscount: 0.8,
    stopVolume: "205000000.00",
  });

  assert.equal(result.resultLimitReached, true);
  assert.equal(result.reason, "result-limit");
  assert.equal(result.candidates.length, 10);
  assert.deepEqual(result.categoryCounts, { range: 5, exactPointFour: 5 });
  assert.equal(result.candidates[0].targetVolume, "213000000.00");
  assert.equal(result.candidates[0].category, rounding.CATEGORIES.RANGE);
  assert.equal(result.candidates[0].rawAmount, "21.300000000");
  assert.equal(result.candidates[0].additionalVolume, "8000000.00");
  assert.equal(result.candidates[5].targetVolume, "214000000.00");
  assert.equal(result.candidates[5].category, rounding.CATEGORIES.EXACT_POINT_FOUR);
  assert.equal(result.candidates[5].rawAmount, "21.400000000");
});

test("第一頁與第二頁的 P−d 共用規則維持一致", () => {
  const cases = [
    [34, 0.8],
    [32.05, 0.8],
    [30.5, 1.125],
    [27, 0],
  ];

  for (const [price, discount] of cases) {
    const exact = search({
      prices: { ...prices, 95: price },
      mode: rounding.MODES.SELF_SERVICE,
      selfServiceDiscount: discount,
    });
    const firstPageValue = calculator.calculateEffectiveUnitPrice(
      price,
      discount,
      "self-service",
    );
    assert.ok(Math.abs(Number(exact.effectiveUnitPrice) - firstPageValue) <= 1e-12);
  }
});


function responseFrom(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}

function updaterOfficialFixture({ date = "1150727", prices = [34, 32, 30.5] } = {}) {
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
      fetchImpl: async () => responseFrom(updaterOfficialFixture()),
    });
    const second = await updatePriceFile({
      dataFile,
      now: new Date("2026-08-06T16:54:03.000Z"),
      fetchImpl: async () => responseFrom(updaterOfficialFixture()),
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
      fetchImpl: async () => responseFrom(updaterOfficialFixture({ date: "1150727" })),
    });
    const before = await readFile(dataFile, "utf8");

    await assert.rejects(
      updatePriceFile({
        dataFile,
        now: new Date("2026-08-06T16:54:03.000Z"),
        fetchImpl: async () => responseFrom(updaterOfficialFixture({ date: "1150726" })),
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
      fetchImpl: async () => responseFrom(updaterOfficialFixture()),
    });
    const before = await readFile(dataFile, "utf8");
    assert.equal(valid.changed, true);

    await assert.rejects(
      updatePriceFile({
        dataFile,
        fetchImpl: async () => responseFrom(updaterOfficialFixture().slice(0, 2)),
      }),
      /92無鉛汽油/,
    );
    assert.equal(await readFile(dataFile, "utf8"), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});



test("本機 Node 伺服器會提供頁面與同一份已驗證油價快照", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpc-local-server-"));
  const calls = [];
  const fetchImpl = async () => {
    calls.push(Date.now());
    return responseFrom(updaterOfficialFixture({ date: "1150914", prices: [34.7, 32.7, 31.2] }));
  };

  try {
    await mkdir(path.join(directory, "data"), { recursive: true });
    await writeFile(path.join(directory, "index.html"), "<!doctype html><title>ranking</title>", "utf8");
    await writeFile(path.join(directory, "rounding.html"), "<!doctype html><title>rounding</title>", "utf8");
    await writeFile(path.join(directory, "styles.css"), "body{}", "utf8");
    await writeFile(path.join(directory, "app.js"), "/* fixture */", "utf8");

    const instance = await createLocalServer({
      rootDir: directory,
      host: "127.0.0.1",
      port: 0,
      fetchImpl,
      refreshTtlMs: 5 * 60 * 1000,
      backgroundIntervalMs: 60 * 60 * 1000,
    });

    try {
      const firstRefresh = await instance.refresh({ force: true });
      assert.equal(firstRefresh.mode, "local");
      assert.deepEqual(firstRefresh.data.prices, { 98: 34.7, 95: 32.7, 92: 31.2 });

      const endpoint = "http://" + instance.host + ":" + instance.port + "/api/prices?refresh=page";
      const [first, second] = await Promise.all([fetch(endpoint), fetch(endpoint)]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const firstJson = await first.json();
      assert.equal(firstJson.runtime.mode, "local");
      assert.equal(firstJson.effectiveDate, "2026-09-14");
      assert.equal(calls.length, 1, "五分鐘快取內不應再次要求官方來源");

      const ranking = await fetch("http://" + instance.host + ":" + instance.port + "/");
      const roundingPage = await fetch("http://" + instance.host + ":" + instance.port + "/rounding.html");
      assert.equal(ranking.status, 200);
      assert.equal(roundingPage.status, 200);
      assert.match(await ranking.text(), /ranking/);
      assert.match(await roundingPage.text(), /rounding/);
    } finally {
      await instance.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("本機同步失敗時保留上一份有效快照並標示 stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpc-local-stale-"));
  try {
    const dataFile = path.join(directory, "data", "cpc-prices.json");
    await updatePriceFile({
      dataFile,
      now: new Date("2026-09-14T00:17:00.000Z"),
      fetchImpl: async () =>
        responseFrom(updaterOfficialFixture({ date: "1150914", prices: [34.7, 32.7, 31.2] })),
    });

    const instance = await createLocalServer({
      rootDir: directory,
      host: "127.0.0.1",
      port: 0,
      fetchImpl: async () => {
        throw new Error("temporary network failure");
      },
      refreshTtlMs: 0,
      backgroundIntervalMs: 60 * 60 * 1000,
    });

    try {
      const result = await instance.refresh({ force: true });
      assert.equal(result.mode, "stale");
      assert.equal(result.data.effectiveDate, "2026-09-14");
      assert.deepEqual(result.data.prices, { 98: 34.7, 95: 32.7, 92: 31.2 });
    } finally {
      await instance.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("直接開啟 HTML 時可使用已驗證的內嵌離線牌價備援", () => {
  const fallback = runtimePrices.offlineFallbackData();
  assert.equal(fallback.runtimeMode, "offline");
  assert.equal(fallback.effectiveDate, "2026-09-14");
  assert.deepEqual(fallback.prices, { 98: 34.7, 95: 32.7, 92: 31.2 });
  assert.equal(fallback.products[95].productName, "95無鉛汽油");
});
