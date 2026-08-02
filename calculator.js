(function initCalculator(globalScope, factory) {
  "use strict";

  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.CpcCalculator = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function calculatorFactory() {
  "use strict";

  const STORAGE_KEY = "cpc-fuel-rewards-calculator:v1";
  const STORAGE_VERSION = 1;
  const ALMOST_TIE_THRESHOLD = 0.001;

  const CARD_TYPES = Object.freeze({
    SIGNATURE: "signature",
    PLATINUM: "platinum",
  });

  const DEFAULT_PRICES = Object.freeze({
    98: 34,
    95: 32,
    92: 30.5,
  });

  const DEFAULT_CONFIG = Object.freeze({
    principal: 3000,
    rechargeRate: 0.04,
    selfServiceDiscount: 0.8,
    cardType: CARD_TYPES.SIGNATURE,
    ctbcPointValue: 0.08,
    vipPointsPerDollar: 2,
    vipFuelPointValue: 0.005,
    vipPremiumPointValue: 0.01,
  });

  const METHOD_META = Object.freeze([
    Object.freeze({
      id: 1,
      key: "recharge-self",
      name: "星期一儲值後自助加油",
      shortName: "儲值後自助",
      serviceMode: "自助",
      paymentMode: "捷利卡",
      vipUsage: "none",
    }),
    Object.freeze({
      id: 2,
      key: "recharge-manual-premium",
      name: "星期一儲值後人工加油，VIP 購買副產品",
      shortName: "儲值人工・VIP 購買副產品",
      serviceMode: "人工",
      paymentMode: "捷利卡",
      vipUsage: "premium",
    }),
    Object.freeze({
      id: 3,
      key: "recharge-manual-fuel",
      name: "星期一儲值後人工加油，VIP 折抵油錢",
      shortName: "儲值人工・VIP 折油",
      serviceMode: "人工",
      paymentMode: "捷利卡",
      vipUsage: "fuel",
    }),
    Object.freeze({
      id: 4,
      key: "direct-self",
      name: "中油 Pay 直接刷聯名卡自助加油",
      shortName: "直刷自助",
      serviceMode: "自助",
      paymentMode: "中油 Pay 聯名卡",
      vipUsage: "none",
    }),
    Object.freeze({
      id: 5,
      key: "direct-manual-premium",
      name: "中油 Pay 直接刷聯名卡人工加油，VIP 購買副產品",
      shortName: "直刷人工・VIP 購買副產品",
      serviceMode: "人工",
      paymentMode: "中油 Pay 聯名卡",
      vipUsage: "premium",
    }),
    Object.freeze({
      id: 6,
      key: "direct-manual-fuel",
      name: "中油 Pay 直接刷聯名卡人工加油，VIP 折抵油錢",
      shortName: "直刷人工・VIP 折油",
      serviceMode: "人工",
      paymentMode: "中油 Pay 聯名卡",
      vipUsage: "fuel",
    }),
  ]);

  function getDefaultState() {
    return {
      prices: { ...DEFAULT_PRICES },
      config: { ...DEFAULT_CONFIG },
    };
  }

  function toNumber(value) {
    if (typeof value === "string" && value.trim() === "") {
      return Number.NaN;
    }
    return Number(value);
  }

  function isFiniteNumber(value) {
    return Number.isFinite(toNumber(value));
  }

  function normalizeConfiguration(rawConfig) {
    return {
      principal: toNumber(rawConfig.principal),
      rechargeRate: toNumber(rawConfig.rechargeRate),
      selfServiceDiscount: toNumber(rawConfig.selfServiceDiscount),
      cardType: rawConfig.cardType,
      ctbcPointValue: toNumber(rawConfig.ctbcPointValue),
      vipPointsPerDollar: toNumber(rawConfig.vipPointsPerDollar),
      vipFuelPointValue: toNumber(rawConfig.vipFuelPointValue),
      vipPremiumPointValue: toNumber(rawConfig.vipPremiumPointValue),
    };
  }

  function validateConfiguration(rawConfig) {
    const config = rawConfig || {};
    const errors = [];
    const positiveFields = [["principal", "比較本金必須大於 0 元。"]];
    const nonNegativeFields = [
      ["rechargeRate", "捷利卡儲值回饋率不可為負數。"],
      ["selfServiceDiscount", "自助每公升折扣不可為負數。"],
      ["vipPointsPerDollar", "人工加油每元 VIP 點數不可為負數。"],
      ["ctbcPointValue", "中信紅利每點價值不可為負數。"],
      ["vipFuelPointValue", "VIP 折抵油錢每點價值不可為負數。"],
      ["vipPremiumPointValue", "VIP 購買副產品每點價值不可為負數。"],
    ];

    positiveFields.forEach(([field, message]) => {
      const value = toNumber(config[field]);
      if (!Number.isFinite(value) || value <= 0) {
        errors.push({ field, message });
      }
    });

    nonNegativeFields.forEach(([field, message]) => {
      const value = toNumber(config[field]);
      if (!Number.isFinite(value) || value < 0) {
        errors.push({ field, message });
      }
    });

    if (!Object.values(CARD_TYPES).includes(config.cardType)) {
      errors.push({ field: "cardType", message: "請選擇御璽卡或白金卡。" });
    }

    return { valid: errors.length === 0, errors };
  }

  function validateFuelPrice(rawPrice, rawDiscount, grade) {
    const price = toNumber(rawPrice);
    const discount = toNumber(rawDiscount);
    const label = grade ? `${grade} 無鉛牌價` : "汽油牌價";

    if (!Number.isFinite(price)) {
      return { valid: false, message: `${label}不可空白，且必須是有效數字。` };
    }
    if (price <= 0) {
      return { valid: false, message: `${label}必須大於 0 元。` };
    }
    if (Number.isFinite(discount) && price <= discount) {
      return {
        valid: false,
        message: `${label}必須大於自助折扣 ${discount} 元。`,
      };
    }
    return { valid: true, value: price };
  }

  function validateInputs(rawPrices, rawConfig) {
    const configResult = validateConfiguration(rawConfig);
    const priceErrors = {};
    ["98", "95", "92"].forEach((grade) => {
      const result = validateFuelPrice(
        rawPrices ? rawPrices[grade] : undefined,
        rawConfig ? rawConfig.selfServiceDiscount : undefined,
        grade,
      );
      if (!result.valid) {
        priceErrors[grade] = result.message;
      }
    });

    return {
      valid: configResult.valid && Object.keys(priceErrors).length === 0,
      priceErrors,
      configErrors: configResult.errors,
      warnings: getActivityWarnings(rawConfig),
    };
  }

  function getActivityWarnings(rawConfig) {
    const principal = toNumber(rawConfig && rawConfig.principal);
    if (!Number.isFinite(principal) || principal <= 0) {
      return [];
    }
    const isMultipleOf500 = Math.abs(principal / 500 - Math.round(principal / 500)) < 1e-10;
    if (principal < 3000 || !isMultipleOf500) {
      return ["目前設定可能不符合星期一4%儲值活動門檻"];
    }
    return [];
  }

  function getCardPointsPer30(cardType) {
    if (cardType === CARD_TYPES.SIGNATURE) return 3;
    if (cardType === CARD_TYPES.PLATINUM) return 2;
    throw new RangeError("不支援的中油聯名卡卡別。" );
  }

  function makeFormulaSteps(result, config) {
    const steps = [];
    const A = config.principal;
    const P = result.listPrice;
    const d = config.selfServiceDiscount;
    const ratePer30 = getCardPointsPer30(config.cardType);

    steps.push({
      label: "中信紅利點數",
      expression: `floor(${A} ÷ 30) × ${ratePer30}`,
      value: result.ctbcPoints,
      unit: "點",
    });
    steps.push({
      label: "中信紅利價值",
      expression: `${result.ctbcPoints} × ${config.ctbcPointValue}`,
      value: result.ctbcValue,
      unit: "元",
    });

    if (result.usesRecharge) {
      steps.push({
        label: "捷利卡可用餘額 B",
        expression: `${A} × (1 + ${config.rechargeRate})`,
        value: result.jieliBalance,
        unit: "元",
      });
      steps.push({
        label: "捷利卡紅利金",
        expression: `${result.jieliBalance} − ${A}`,
        value: result.jieliBonus,
        unit: "元",
      });
    }

    if (result.serviceMode === "自助") {
      steps.push({
        label: "自助實際單價 U",
        expression: `${P} − ${d}`,
        value: result.actualUnitPrice,
        unit: "元／公升",
      });
      steps.push({
        label: "可加公升數",
        expression: `${result.fuelBudget} ÷ ${result.actualUnitPrice}`,
        value: result.liters,
        unit: "公升",
      });
      steps.push({
        label: "自助折讓",
        expression: `${result.liters} × ${d}`,
        value: result.selfServiceSavings,
        unit: "元",
      });
    } else {
      steps.push({
        label: "可加公升數",
        expression: `${result.fuelBudget} ÷ ${P}`,
        value: result.liters,
        unit: "公升",
      });
      steps.push({
        label: "VIP 點數",
        expression: `floor(${result.fuelBudget}) × ${config.vipPointsPerDollar}`,
        value: result.vipPoints,
        unit: "點",
      });
      steps.push({
        label: "VIP 點數價值",
        expression: `${result.vipPoints} × ${result.vipPointUnitValue}`,
        value: result.vipValue,
        unit: "元",
      });
    }

    const rewardParts = [];
    if (result.jieliBonus) rewardParts.push(result.jieliBonus);
    if (result.selfServiceSavings) rewardParts.push(result.selfServiceSavings);
    rewardParts.push(result.ctbcValue);
    if (result.vipValue) rewardParts.push(result.vipValue);

    steps.push({
      label: "總回饋",
      expression: rewardParts.join(" + "),
      value: result.totalReward,
      unit: "元",
    });
    steps.push({
      label: "總等值",
      expression: `${A} + ${result.totalReward}`,
      value: result.totalEquivalent,
      unit: "元",
    });
    steps.push({
      label: "精確有效回饋率",
      expression: `${result.totalReward} ÷ ${A} × 100%`,
      value: result.preciseRate,
      unit: "%",
    });
    steps.push({
      label: "廣告式簡單加總回饋率",
      expression: result.advertisedRateFormula,
      value: result.advertisedRate,
      unit: "%",
    });
    steps.push({
      label: "兩種回饋率差異",
      expression: `${result.preciseRate} − ${result.advertisedRate}`,
      value: result.rateDifference,
      unit: "個百分點",
    });
    steps.push({
      label: "有效每公升成本",
      expression: `(${A} − ${result.ctbcValue}${result.vipValue ? ` − ${result.vipValue}` : ""}) ÷ ${result.liters}`,
      value: result.effectiveCostPerLiter,
      unit: "元／公升",
    });

    if (result.crossCheckTotal !== null) {
      steps.push({
        label: "交叉驗證總回饋",
        expression: `${P} × ${result.liters} + ${result.ctbcValue} − ${A}`,
        value: result.crossCheckTotal,
        unit: "元",
        note: `與逐項加總差 ${result.crossCheckDifference} 元`,
      });
    }

    return steps;
  }

  function calculateFuel(rawPrice, rawConfig, grade) {
    const configResult = validateConfiguration(rawConfig);
    const priceResult = validateFuelPrice(rawPrice, rawConfig.selfServiceDiscount, grade);
    if (!configResult.valid || !priceResult.valid) {
      const messages = [
        ...configResult.errors.map((error) => error.message),
        ...(priceResult.valid ? [] : [priceResult.message]),
      ];
      throw new RangeError(messages.join(" "));
    }
    const config = normalizeConfiguration(rawConfig);

    const P = priceResult.value;
    const A = toNumber(config.principal);
    const r = toNumber(config.rechargeRate);
    const d = toNumber(config.selfServiceDiscount);
    const B = A * (1 + r);
    const U = P - d;
    const cardPointsPer30 = getCardPointsPer30(config.cardType);
    const ctbcPoints = Math.floor(A / 30) * cardPointsPer30;
    const ctbcValue = ctbcPoints * config.ctbcPointValue;
    const jieliBonus = B - A;

    function buildResult(meta, options) {
      const totalReward =
        options.jieliBonus +
        options.selfServiceSavings +
        ctbcValue +
        options.vipValue;
      const preciseRate = (totalReward / A) * 100;
      const effectiveCostPerLiter =
        (A - ctbcValue - options.vipValue) / options.liters;
      const totalEquivalent = A + totalReward;
      const rateDifference = preciseRate - options.advertisedRate;
      const crossCheckTotal =
        meta.serviceMode === "自助"
          ? P * options.liters + ctbcValue - A
          : null;
      const crossCheckDifference =
        crossCheckTotal === null ? null : totalReward - crossCheckTotal;

      const result = {
        ...meta,
        grade: String(grade || ""),
        listPrice: P,
        actualUnitPrice: meta.serviceMode === "自助" ? U : P,
        actualSpend: A,
        fuelBudget: options.fuelBudget,
        usesRecharge: options.usesRecharge,
        jieliBalance: options.usesRecharge ? B : null,
        liters: options.liters,
        jieliBonus: options.jieliBonus,
        selfServiceSavings: options.selfServiceSavings,
        ctbcPoints,
        ctbcValue,
        vipPoints: options.vipPoints,
        vipPointUnitValue: options.vipPointUnitValue,
        vipValuationLabel: options.vipValuationLabel,
        vipValue: options.vipValue,
        totalReward,
        totalEquivalent,
        preciseRate,
        effectiveCostPerLiter,
        advertisedRate: options.advertisedRate,
        advertisedRateFormula: options.advertisedRateFormula,
        rateDifference,
        crossCheckTotal,
        crossCheckDifference,
      };

      result.formulaSteps = makeFormulaSteps(result, config);
      return result;
    }

    const ctbcRate = ctbcValue / A;
    const rechargeSelfLiters = B / U;
    const rechargeVipPoints = Math.floor(B) * config.vipPointsPerDollar;
    const directSelfLiters = A / U;
    const directVipPoints = Math.floor(A) * config.vipPointsPerDollar;

    const methods = METHOD_META.map((meta) => {
      switch (meta.id) {
        case 1: {
          const advertisedRate = (r + ctbcRate + d / P) * 100;
          return buildResult(meta, {
            fuelBudget: B,
            usesRecharge: true,
            liters: rechargeSelfLiters,
            jieliBonus,
            selfServiceSavings: rechargeSelfLiters * d,
            vipPoints: 0,
            vipPointUnitValue: 0,
            vipValuationLabel: "不適用（自助加油不累積 VIP 點數）",
            vipValue: 0,
            advertisedRate,
            advertisedRateFormula: `${r * 100}% + ${ctbcRate * 100}% + ${d} ÷ ${P} × 100%`,
          });
        }
        case 2: {
          const vipValue = rechargeVipPoints * config.vipPremiumPointValue;
          const advertisedRate =
            (r + ctbcRate + config.vipPointsPerDollar * config.vipPremiumPointValue) * 100;
          return buildResult(meta, {
            fuelBudget: B,
            usesRecharge: true,
            liters: B / P,
            jieliBonus,
            selfServiceSavings: 0,
            vipPoints: rechargeVipPoints,
            vipPointUnitValue: config.vipPremiumPointValue,
            vipValuationLabel: "複合商店／洗車／快保估值（非現金、非折油）",
            vipValue,
            advertisedRate,
            advertisedRateFormula: `${r * 100}% + ${ctbcRate * 100}% + ${config.vipPointsPerDollar} × ${config.vipPremiumPointValue} × 100%`,
          });
        }
        case 3: {
          const vipValue = rechargeVipPoints * config.vipFuelPointValue;
          const advertisedRate =
            (r + ctbcRate + config.vipPointsPerDollar * config.vipFuelPointValue) * 100;
          return buildResult(meta, {
            fuelBudget: B,
            usesRecharge: true,
            liters: B / P,
            jieliBonus,
            selfServiceSavings: 0,
            vipPoints: rechargeVipPoints,
            vipPointUnitValue: config.vipFuelPointValue,
            vipValuationLabel: "折抵油錢估值",
            vipValue,
            advertisedRate,
            advertisedRateFormula: `${r * 100}% + ${ctbcRate * 100}% + ${config.vipPointsPerDollar} × ${config.vipFuelPointValue} × 100%`,
          });
        }
        case 4: {
          const advertisedRate = (ctbcRate + d / P) * 100;
          return buildResult(meta, {
            fuelBudget: A,
            usesRecharge: false,
            liters: directSelfLiters,
            jieliBonus: 0,
            selfServiceSavings: directSelfLiters * d,
            vipPoints: 0,
            vipPointUnitValue: 0,
            vipValuationLabel: "不適用（自助加油不累積 VIP 點數）",
            vipValue: 0,
            advertisedRate,
            advertisedRateFormula: `${ctbcRate * 100}% + ${d} ÷ ${P} × 100%`,
          });
        }
        case 5: {
          const vipValue = directVipPoints * config.vipPremiumPointValue;
          const advertisedRate =
            (ctbcRate + config.vipPointsPerDollar * config.vipPremiumPointValue) * 100;
          return buildResult(meta, {
            fuelBudget: A,
            usesRecharge: false,
            liters: A / P,
            jieliBonus: 0,
            selfServiceSavings: 0,
            vipPoints: directVipPoints,
            vipPointUnitValue: config.vipPremiumPointValue,
            vipValuationLabel: "複合商店／洗車／快保估值（非現金、非折油）",
            vipValue,
            advertisedRate,
            advertisedRateFormula: `${ctbcRate * 100}% + ${config.vipPointsPerDollar} × ${config.vipPremiumPointValue} × 100%`,
          });
        }
        case 6: {
          const vipValue = directVipPoints * config.vipFuelPointValue;
          const advertisedRate =
            (ctbcRate + config.vipPointsPerDollar * config.vipFuelPointValue) * 100;
          return buildResult(meta, {
            fuelBudget: A,
            usesRecharge: false,
            liters: A / P,
            jieliBonus: 0,
            selfServiceSavings: 0,
            vipPoints: directVipPoints,
            vipPointUnitValue: config.vipFuelPointValue,
            vipValuationLabel: "折抵油錢估值",
            vipValue,
            advertisedRate,
            advertisedRateFormula: `${ctbcRate * 100}% + ${config.vipPointsPerDollar} × ${config.vipFuelPointValue} × 100%`,
          });
        }
        default:
          throw new Error("未知的比較方法。" );
      }
    });

    const ranking = rankMethods(methods);
    const winner = ranking[0];
    const runnerUp = ranking[1];

    return {
      grade: String(grade || ""),
      price: P,
      selfServicePrice: U,
      advertisedDiscountRate: (d / P) * 100,
      extraPurchasingPower: (d / U) * 100,
      methods,
      ranking,
      winner,
      runnerUp,
      winnerAdvantage: {
        amount: winner.totalReward - runnerUp.totalReward,
        percentagePoints: winner.preciseRate - runnerUp.preciseRate,
        almostTie:
          Math.abs(winner.preciseRate - runnerUp.preciseRate) < ALMOST_TIE_THRESHOLD,
      },
    };
  }

  function rankMethods(methods) {
    const sorted = [...methods].sort((left, right) => {
      const rateDifference = right.preciseRate - left.preciseRate;
      return Math.abs(rateDifference) > 1e-12 ? rateDifference : left.id - right.id;
    });

    return sorted.map((method, index) => {
      const previous = sorted[index - 1];
      const next = sorted[index + 1];
      return {
        ...method,
        rank: index + 1,
        almostTieWithPrevious:
          Boolean(previous) &&
          Math.abs(previous.preciseRate - method.preciseRate) < ALMOST_TIE_THRESHOLD,
        almostTieWithNext:
          Boolean(next) &&
          Math.abs(method.preciseRate - next.preciseRate) < ALMOST_TIE_THRESHOLD,
      };
    });
  }

  function calculateBreakEven(config, context, vipUsage) {
    const validation = validateConfiguration(config);
    if (!validation.valid) {
      throw new RangeError(validation.errors.map((error) => error.message).join(" "));
    }
    if (!["recharge", "direct"].includes(context)) {
      throw new RangeError("損益兩平情境必須是 recharge 或 direct。" );
    }
    if (!["premium", "fuel"].includes(vipUsage)) {
      throw new RangeError("VIP 點數用途必須是 premium 或 fuel。" );
    }

    const normalizedConfig = normalizeConfiguration(config);
    const A = normalizedConfig.principal;
    const spend = context === "recharge" ? A * (1 + normalizedConfig.rechargeRate) : A;
    const vipPoints = Math.floor(spend) * normalizedConfig.vipPointsPerDollar;
    const unitValue =
      vipUsage === "premium"
        ? normalizedConfig.vipPremiumPointValue
        : normalizedConfig.vipFuelPointValue;
    const vipValue = vipPoints * unitValue;
    const discount = normalizedConfig.selfServiceDiscount;
    const selfMethodId = context === "recharge" ? 1 : 4;
    const manualMethodId =
      context === "recharge"
        ? vipUsage === "premium"
          ? 2
          : 3
        : vipUsage === "premium"
          ? 5
          : 6;

    if (discount <= 0 || vipValue <= 0) {
      return {
        context,
        vipUsage,
        selfMethodId,
        manualMethodId,
        price: null,
        spend,
        vipPoints,
        vipValue,
        residual: null,
        reason: "自助折扣或 VIP 估值為 0，沒有有限的正牌價損益兩平點。",
      };
    }

    // spend × d ÷ (P − d) = VIP 點數價值，解得 P = d + spend × d ÷ VIP 價值。
    const price = discount + (spend * discount) / vipValue;
    const selfServiceValueAtBreakEven = (spend * discount) / (price - discount);
    const residual = selfServiceValueAtBreakEven - vipValue;

    return {
      context,
      vipUsage,
      selfMethodId,
      manualMethodId,
      price,
      spend,
      vipPoints,
      vipValue,
      selfServiceValueAtBreakEven,
      residual,
      equation: `${spend} × ${discount} ÷ (P − ${discount}) = ${vipValue}`,
      solvedFormula: `P = ${discount} + (${spend} × ${discount}) ÷ ${vipValue}`,
    };
  }

  function calculateAll(rawPrices, rawConfig) {
    const validation = validateInputs(rawPrices, rawConfig);
    if (!validation.valid) {
      const messages = [
        ...Object.values(validation.priceErrors),
        ...validation.configErrors.map((error) => error.message),
      ];
      throw new RangeError(messages.join(" "));
    }

    const config = normalizeConfiguration(rawConfig);
    const prices = {
      98: toNumber(rawPrices[98]),
      95: toNumber(rawPrices[95]),
      92: toNumber(rawPrices[92]),
    };
    const fuels = {
      98: calculateFuel(prices[98], config, "98"),
      95: calculateFuel(prices[95], config, "95"),
      92: calculateFuel(prices[92], config, "92"),
    };
    const breakEven = [
      calculateBreakEven(config, "recharge", "premium"),
      calculateBreakEven(config, "recharge", "fuel"),
      calculateBreakEven(config, "direct", "premium"),
      calculateBreakEven(config, "direct", "fuel"),
    ];

    return {
      prices,
      config,
      fuels,
      breakEven,
      warnings: validation.warnings,
    };
  }

  function savePreferences(storage, state) {
    if (!storage || typeof storage.setItem !== "function") return false;
    const payload = {
      version: STORAGE_VERSION,
      prices: { ...state.prices },
      config: { ...state.config },
    };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function loadPreferences(storage) {
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      const rawValue = storage.getItem(STORAGE_KEY);
      if (!rawValue) return null;
      const payload = JSON.parse(rawValue);
      if (!payload || payload.version !== STORAGE_VERSION) return null;
      const defaults = getDefaultState();
      const merged = {
        prices: { ...defaults.prices, ...(payload.prices || {}) },
        config: { ...defaults.config, ...(payload.config || {}) },
      };
      const validation = validateInputs(merged.prices, merged.config);
      if (!validation.valid) return null;
      return {
        prices: {
          98: toNumber(merged.prices[98]),
          95: toNumber(merged.prices[95]),
          92: toNumber(merged.prices[92]),
        },
        config: {
          principal: toNumber(merged.config.principal),
          rechargeRate: toNumber(merged.config.rechargeRate),
          selfServiceDiscount: toNumber(merged.config.selfServiceDiscount),
          cardType: merged.config.cardType,
          ctbcPointValue: toNumber(merged.config.ctbcPointValue),
          vipPointsPerDollar: toNumber(merged.config.vipPointsPerDollar),
          vipFuelPointValue: toNumber(merged.config.vipFuelPointValue),
          vipPremiumPointValue: toNumber(merged.config.vipPremiumPointValue),
        },
      };
    } catch (_error) {
      return null;
    }
  }

  function clearPreferences(storage) {
    if (!storage || typeof storage.removeItem !== "function") return false;
    try {
      storage.removeItem(STORAGE_KEY);
      return true;
    } catch (_error) {
      return false;
    }
  }

  return Object.freeze({
    STORAGE_KEY,
    ALMOST_TIE_THRESHOLD,
    CARD_TYPES,
    DEFAULT_PRICES,
    DEFAULT_CONFIG,
    METHOD_META,
    getDefaultState,
    toNumber,
    isFiniteNumber,
    normalizeConfiguration,
    validateConfiguration,
    validateFuelPrice,
    validateInputs,
    getActivityWarnings,
    getCardPointsPer30,
    calculateFuel,
    rankMethods,
    calculateBreakEven,
    calculateAll,
    savePreferences,
    loadPreferences,
    clearPreferences,
  });
});
