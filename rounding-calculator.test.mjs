import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rounding = require("./rounding-calculator.js");
const calculator = require("./calculator.js");

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

test("T2：一般條件回傳十筆，接近上限可不足十筆，且永不超過十筆", () => {
  assert.equal(search().candidates.length, 10);

  const nearLimit = search({ stopVolume: "93.70" });
  assert.deepEqual(
    nearLimit.candidates.map((candidate) => candidate.targetVolume),
    ["93.73"],
  );
  assert.equal(nearLimit.candidates.length, 1);
  assert.equal(nearLimit.amountLimitReached, true);
  assert.ok(search({ limit: 4 }).candidates.length <= 4);
  assert.ok(search().candidates.length <= 10);
});

test("T3：結果依目標公升與增加量嚴格遞增", () => {
  const result = search();
  for (let index = 1; index < result.candidates.length; index += 1) {
    const previous = result.candidates[index - 1];
    const current = result.candidates[index];
    assert.ok(Number(current.targetVolume) > Number(previous.targetVolume));
    assert.ok(Number(current.additionalVolume) > Number(previous.additionalVolume));
    assert.equal(
      Number((Number(current.targetVolume) - Number(result.stopVolume)).toFixed(2)),
      Number(current.additionalVolume),
    );
  }
});

test("T4：只納入 .300（含）至 .500（不含）的精確小數區間", () => {
  const cases = [
    ["320.299", false, 320n],
    ["320.300", true, 320n],
    ["320.301", true, 320n],
    ["320.499", true, 320n],
    ["320.500", false, 321n],
    ["320.501", false, 321n],
    ["320.000", false, 320n],
  ];
  for (const [amount, qualifies, roundedAmount] of cases) {
    assert.deepEqual(rounding.classifyUnroundedAmount(amount), {
      qualifies,
      roundedAmount,
    });
  }

  const actualSearch = search({ prices: { ...prices, 95: 10 } });
  assert.ok(actualSearch.candidates.some((candidate) => candidate.rawAmount === "100.300"));
  assert.equal(actualSearch.candidates.some((candidate) => candidate.rawAmount === "100.500"), false);
  for (const candidate of actualSearch.candidates) {
    assert.equal(rounding.classifyUnroundedAmount(candidate.rawAmount).qualifies, true);
  }
});

test("T5：人工模式直接使用人工油價乘以候選公升數", () => {
  const first = search().candidates[0];
  assert.equal(first.targetVolume, "10.01");
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
  assert.equal(result.candidates[0].rawAmount, "312.312");
  assert.equal(result.candidates[0].roundedAmount, "312");

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
  }
});

test("T8：32.0 元與 10.00 L 固定案例精確回傳指定前十筆", () => {
  const result = search();
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.targetVolume),
    ["10.01", "10.14", "10.17", "10.20", "10.23", "10.26", "10.39", "10.42", "10.45", "10.48"],
  );
  assert.deepEqual(result.candidates[0], {
    rank: 1,
    targetVolume: "10.01",
    additionalVolume: "0.01",
    additionalMilliliters: "10",
    rawAmount: "320.320",
    roundedAmount: "320",
  });
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

test("T11：兩頁共用既有 localStorage key，清除後第二頁嚴格讀取為空", () => {
  const storage = new MemoryStorage();
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
  assert.equal(result.candidates[0].targetVolume, "213000000.00");
  assert.equal(result.candidates[0].rawAmount, "21.300000000");
  assert.equal(result.candidates[0].additionalVolume, "8000000.00");
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
