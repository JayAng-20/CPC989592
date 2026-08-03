import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const calculator = require("./calculator.js");

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
