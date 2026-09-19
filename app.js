/*

 * CPC Fuel Rewards Calculator

 * Browser application, calculation core, local synchronizer, and CLI.

 * This single file intentionally replaces the former split JavaScript files.

 */

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
  const THEME_STORAGE_KEY = "cpc-fuel-rewards-theme";
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

  function calculateEffectiveUnitPrice(rawPrice, rawDiscount, mode = "self-service") {
    const price = toNumber(rawPrice);
    const discount = toNumber(rawDiscount);

    if (!Number.isFinite(price) || price <= 0) {
      throw new RangeError("人工牌價必須是大於 0 的有效數字。");
    }
    if (mode === "manual") return price;
    if (mode !== "self-service") {
      throw new RangeError("加油模式必須是人工加油或自助加油。");
    }
    if (!Number.isFinite(discount) || discount < 0) {
      throw new RangeError("自助每公升優惠必須是 0 或正數。");
    }

    const effectivePrice = price - discount;
    if (effectivePrice <= 0) {
      throw new RangeError("自助有效單價必須大於 0 元。");
    }
    return effectivePrice;
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
    const U = calculateEffectiveUnitPrice(P, d, "self-service");
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

  function normalizePriceMeta(rawMeta) {
    if (!rawMeta || typeof rawMeta !== "object") return null;
    const effectiveDate = typeof rawMeta.effectiveDate === "string" ? rawMeta.effectiveDate : "";
    const retrievedAt = typeof rawMeta.retrievedAt === "string" ? rawMeta.retrievedAt : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;
    if (!retrievedAt || Number.isNaN(new Date(retrievedAt).getTime())) return null;
    return {
      effectiveDate,
      retrievedAt: new Date(retrievedAt).toISOString(),
      source: typeof rawMeta.source === "string" ? rawMeta.source : "台灣中油政府資料開放平台",
      sourceUrl: typeof rawMeta.sourceUrl === "string" ? rawMeta.sourceUrl : "",
    };
  }

  function savePreferences(storage, state) {
    if (!storage || typeof storage.setItem !== "function") return false;
    const payload = {
      version: STORAGE_VERSION,
      prices: { ...state.prices },
      config: { ...state.config },
    };
    const priceMeta = normalizePriceMeta(state.priceMeta);
    if (priceMeta) payload.priceMeta = priceMeta;
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
      const state = {
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
      const priceMeta = normalizePriceMeta(payload.priceMeta);
      if (priceMeta) state.priceMeta = priceMeta;
      return state;
    } catch (_error) {
      return null;
    }
  }

  function loadSharedFuelState(storage) {
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      const rawValue = storage.getItem(STORAGE_KEY);
      if (!rawValue) return null;
      const payload = JSON.parse(rawValue);
      const hasOwn = (object, property) =>
        object !== null &&
        typeof object === "object" &&
        Object.prototype.hasOwnProperty.call(object, property);
      const isStoredNumber = (value) =>
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));

      if (
        !payload ||
        payload.version !== STORAGE_VERSION ||
        !hasOwn(payload, "prices") ||
        !hasOwn(payload.prices, "98") ||
        !hasOwn(payload.prices, "95") ||
        !hasOwn(payload.prices, "92") ||
        !hasOwn(payload, "config") ||
        !hasOwn(payload.config, "selfServiceDiscount")
      ) {
        return null;
      }

      if (
        !isStoredNumber(payload.prices[98]) ||
        !isStoredNumber(payload.prices[95]) ||
        !isStoredNumber(payload.prices[92]) ||
        !isStoredNumber(payload.config.selfServiceDiscount)
      ) {
        return null;
      }

      return loadPreferences(storage);
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
    THEME_STORAGE_KEY,
    ALMOST_TIE_THRESHOLD,
    CARD_TYPES,
    DEFAULT_PRICES,
    DEFAULT_CONFIG,
    METHOD_META,
    getDefaultState,
    toNumber,
    isFiniteNumber,
    calculateEffectiveUnitPrice,
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
    loadSharedFuelState,
    clearPreferences,
  });
});


(function initCpcPriceData(globalScope, factory) {
  "use strict";

  const api = factory(globalScope);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.CpcPriceData = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function priceDataFactory(globalScope) {
  "use strict";

  const DATA_PATH = "data/cpc-prices.json";
  const OFFICIAL_SOURCE_URL = "https://vipmbr.cpc.com.tw/opendata/MainProdListPrice";
  const DATASET_URL = "https://data.gov.tw/dataset/6339";
  const GRADES = Object.freeze(["98", "95", "92"]);
  const PRODUCT_DEFINITIONS = Object.freeze({
    98: Object.freeze({
      name: "98無鉛汽油",
      typeName: "汽柴油零售",
      deliveryLocation: "中油自營站",
    }),
    95: Object.freeze({
      name: "95無鉛汽油",
      typeName: "汽柴油零售",
      deliveryLocation: "中油自營站",
    }),
    92: Object.freeze({
      name: "92無鉛汽油",
      typeName: "汽柴油零售",
      deliveryLocation: "中油自營站",
    }),
  });

  function text(value) {
    return String(value ?? "").trim();
  }

  function normalizeUnit(value) {
    return text(value).replace(/\s+/g, "").replace(/／/g, "/");
  }

  function isValidDateParts(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  function datePartsToIso(year, month, day, fieldName) {
    if (!isValidDateParts(year, month, day)) {
      throw new RangeError(`${fieldName}不是有效日期。`);
    }
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseOfficialDate(rawValue, fieldName = "牌價生效日期") {
    const source = text(rawValue);
    if (!source) throw new TypeError(`${fieldName}不可空白。`);

    if (/^\d{7}$/.test(source)) {
      const year = Number(source.slice(0, 3)) + 1911;
      const month = Number(source.slice(3, 5));
      const day = Number(source.slice(5, 7));
      return datePartsToIso(year, month, day, fieldName);
    }

    if (/^\d{8}$/.test(source)) {
      return datePartsToIso(
        Number(source.slice(0, 4)),
        Number(source.slice(4, 6)),
        Number(source.slice(6, 8)),
        fieldName,
      );
    }

    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
    if (isoMatch) {
      return datePartsToIso(
        Number(isoMatch[1]),
        Number(isoMatch[2]),
        Number(isoMatch[3]),
        fieldName,
      );
    }

    const slashMatch = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(source);
    if (slashMatch) {
      return datePartsToIso(
        Number(slashMatch[1]),
        Number(slashMatch[2]),
        Number(slashMatch[3]),
        fieldName,
      );
    }

    throw new TypeError(`${fieldName}格式錯誤，應為民國日期或 YYYY-MM-DD。`);
  }

  function normalizeRetrievedAt(rawValue) {
    const source = rawValue instanceof Date ? rawValue.toISOString() : text(rawValue);
    const date = new Date(source);
    if (!source || Number.isNaN(date.getTime())) {
      throw new TypeError("資料同步時間必須是有效的 ISO 日期時間。" );
    }
    return date.toISOString();
  }

  function positivePrice(rawValue, label) {
    const price = Number(rawValue);
    if (!Number.isFinite(price) || price <= 0) {
      throw new RangeError(`${label}必須是大於 0 的有效數字。`);
    }
    return price;
  }

  function normalizeProduct(rawProduct, grade) {
    if (!rawProduct || typeof rawProduct !== "object") {
      throw new TypeError(`${grade} 無鉛汽油資料格式錯誤。`);
    }

    const definition = PRODUCT_DEFINITIONS[grade];
    const productName = text(rawProduct.productName);
    const unit = text(rawProduct.unit);
    const deliveryLocation = text(rawProduct.deliveryLocation);
    const effectiveDate = parseOfficialDate(rawProduct.effectiveDate, `${grade} 無鉛汽油牌價生效日期`);

    if (productName !== definition.name) {
      throw new Error(`${grade} 無鉛汽油產品名稱不符合官方資料篩選條件。`);
    }
    if (normalizeUnit(unit) !== "元/公升") {
      throw new Error(`${grade} 無鉛汽油計價單位不是元／公升。`);
    }
    if (deliveryLocation !== definition.deliveryLocation) {
      throw new Error(`${grade} 無鉛汽油交貨地點不是中油自營站。`);
    }

    const result = {
      productName,
      price: positivePrice(rawProduct.price, `${grade} 無鉛汽油牌價`),
      effectiveDate,
      unit,
      deliveryLocation,
    };
    if (rawProduct.productCode !== undefined) result.productCode = text(rawProduct.productCode);
    if (rawProduct.typeName !== undefined) result.typeName = text(rawProduct.typeName);
    return result;
  }

  function validatePriceData(rawData) {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      throw new TypeError("油價資料檔必須是 JSON 物件。" );
    }

    const source = text(rawData.source);
    const sourceUrl = text(rawData.sourceUrl);
    const datasetUrl = text(rawData.datasetUrl);
    if (!source) throw new TypeError("油價資料缺少資料來源。" );
    if (sourceUrl !== OFFICIAL_SOURCE_URL) throw new Error("油價資料來源不是台灣中油官方 JSON。" );
    if (datasetUrl !== DATASET_URL) throw new Error("油價資料集網址不是政府資料開放平台資料集 6339。" );

    const effectiveDate = parseOfficialDate(rawData.effectiveDate);
    const retrievedAt = normalizeRetrievedAt(rawData.retrievedAt);
    if (!rawData.prices || typeof rawData.prices !== "object") {
      throw new TypeError("油價資料缺少 prices 欄位。" );
    }
    if (!rawData.products || typeof rawData.products !== "object") {
      throw new TypeError("油價資料缺少 products 欄位，無法確認官方產品欄位。" );
    }

    const prices = {};
    const products = {};
    GRADES.forEach((grade) => {
      prices[grade] = positivePrice(rawData.prices[grade], `${grade} 無鉛汽油牌價`);
      products[grade] = normalizeProduct(rawData.products[grade], grade);
      if (products[grade].price !== prices[grade]) {
        throw new Error(`${grade} 無鉛汽油的 prices 與 products 牌價不一致。` );
      }
      if (products[grade].effectiveDate !== effectiveDate) {
        throw new Error(`${grade} 無鉛汽油牌價生效日期與資料檔不一致。` );
      }
    });

    return {
      source,
      sourceUrl,
      datasetUrl,
      retrievedAt,
      effectiveDate,
      prices,
      products,
    };
  }

  function normalizeOfficialPayload(rawPayload, retrievedAt = new Date().toISOString()) {
    if (!Array.isArray(rawPayload)) {
      throw new TypeError("台灣中油官方 JSON 必須是產品陣列。" );
    }

    const products = {};
    const effectiveDates = new Set();

    GRADES.forEach((grade) => {
      const definition = PRODUCT_DEFINITIONS[grade];
      const matches = rawPayload.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return (
          text(item["產品名稱"]) === definition.name &&
          text(item["型別名稱"]) === definition.typeName &&
          normalizeUnit(item["計價單位"]) === "元/公升" &&
          text(item["交貨地點"]) === definition.deliveryLocation
        );
      });

      if (matches.length !== 1) {
        throw new Error(`${definition.name} 官方資料應有且只有一筆中油自營站元／公升零售牌價，實際找到 ${matches.length} 筆。` );
      }

      const item = matches[0];
      const effectiveDate = parseOfficialDate(item["牌價生效日期"], `${definition.name} 牌價生效日期`);
      const product = {
        productName: definition.name,
        price: positivePrice(item["參考牌價_金額"], `${definition.name} 參考牌價`),
        effectiveDate,
        unit: text(item["計價單位"]),
        deliveryLocation: text(item["交貨地點"]),
      };
      if (item["產品編號"] !== undefined) product.productCode = text(item["產品編號"]);
      if (item["型別名稱"] !== undefined) product.typeName = text(item["型別名稱"]);
      products[grade] = product;
      effectiveDates.add(effectiveDate);
    });

    if (effectiveDates.size !== 1) {
      throw new Error("98、95、92 無鉛汽油的牌價生效日期不一致，拒絕更新。" );
    }

    return validatePriceData({
      source: "台灣中油政府資料開放平台",
      sourceUrl: OFFICIAL_SOURCE_URL,
      datasetUrl: DATASET_URL,
      retrievedAt,
      effectiveDate: [...effectiveDates][0],
      prices: Object.fromEntries(GRADES.map((grade) => [grade, products[grade].price])),
      products,
    });
  }

  function buildDataUrl(path = DATA_PATH, knownEffectiveDate = "") {
    const separator = path.includes("?") ? "&" : "?";
    const version = knownEffectiveDate || "latest";
    return `${path}${separator}version=${encodeURIComponent(version)}`;
  }

  async function loadPriceData(options = {}) {
    const fetchImpl = options.fetchImpl || globalScope.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("目前瀏覽器不支援讀取官方油價資料。" );
    }

    const path = buildDataUrl(options.path || DATA_PATH, options.knownEffectiveDate || "");
    let response;
    try {
      response = await fetchImpl(path, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      throw new Error(`官方油價資料讀取失敗：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response || !response.ok) {
      throw new Error(`官方油價資料檔讀取失敗（HTTP ${response && response.status ? response.status : "未知"}）。`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`官方油價資料檔不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    return validatePriceData(payload);
  }

  function formatEffectiveDate(value) {
    const iso = parseOfficialDate(value);
    return iso.replace(/-/g, "/");
  }

  return Object.freeze({
    DATA_PATH,
    OFFICIAL_SOURCE_URL,
    DATASET_URL,
    GRADES,
    PRODUCT_DEFINITIONS,
    parseOfficialDate,
    validatePriceData,
    normalizeOfficialPayload,
    buildDataUrl,
    loadPriceData,
    formatEffectiveDate,
  });
});


(function initRoundingCalculator(globalScope, factory) {
  "use strict";

  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.CpcRoundingCalculator = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function roundingCalculatorFactory() {
  "use strict";

  const GRADES = Object.freeze(["98", "95", "92"]);
  const MODES = Object.freeze({
    MANUAL: "manual",
    SELF_SERVICE: "self-service",
  });
  const CATEGORIES = Object.freeze({
    RANGE: "range",
    EXACT_POINT_FOUR: "exact-point-four",
  });
  const MIN_AMOUNT = 20n;
  const MAX_AMOUNT = 3000n;
  const CATEGORY_RESULT_LIMIT = 5;
  const DEFAULT_RESULT_LIMIT = CATEGORY_RESULT_LIMIT * 2;
  const MAX_DECIMAL_SCALE = 24;

  function powerOfTen(scale) {
    return 10n ** BigInt(scale);
  }

  function parseDecimal(rawValue, options = {}) {
    const fieldName = options.fieldName || "數值";
    const allowZero = options.allowZero !== false;
    const allowNegative = options.allowNegative === true;

    if (typeof rawValue === "number" && !Number.isFinite(rawValue)) {
      throw new TypeError(`${fieldName}必須是有效數字。`);
    }

    const source = String(rawValue ?? "").trim();
    if (!source) throw new TypeError(`${fieldName}不可空白。`);

    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(source);
    if (!match) throw new TypeError(`${fieldName}必須是有效十進位數字。`);

    const negative = match[1] === "-";
    if (negative && !allowNegative) {
      throw new RangeError(`${fieldName}不可為負數。`);
    }

    const fraction = match[3] || "";
    const exponent = Number(match[4] || 0);
    if (!Number.isSafeInteger(exponent)) {
      throw new RangeError(`${fieldName}的小數位數過大。`);
    }

    let digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, "");
    let scale = fraction.length - exponent;
    if (scale < 0) {
      digits += "0".repeat(-scale);
      scale = 0;
    }
    if (scale > MAX_DECIMAL_SCALE || digits.length > 80) {
      throw new RangeError(`${fieldName}最多支援 ${MAX_DECIMAL_SCALE} 位小數。`);
    }

    let units = BigInt(digits || "0");
    if (negative) units = -units;
    if (!allowZero && units === 0n) {
      throw new RangeError(`${fieldName}必須大於 0。`);
    }

    return { units, scale };
  }

  function normalizeDecimal(decimal, minimumScale = 0) {
    let { units, scale } = decimal;
    while (scale > minimumScale && units % 10n === 0n) {
      units /= 10n;
      scale -= 1;
    }
    if (scale < minimumScale) {
      units *= powerOfTen(minimumScale - scale);
      scale = minimumScale;
    }
    return { units, scale };
  }

  function alignDecimals(left, right, minimumScale = 0) {
    const scale = Math.max(left.scale, right.scale, minimumScale);
    return {
      leftUnits: left.units * powerOfTen(scale - left.scale),
      rightUnits: right.units * powerOfTen(scale - right.scale),
      scale,
    };
  }

  function formatDecimal(decimal, minimumFractionDigits = 0) {
    const negative = decimal.units < 0n;
    const absolute = negative ? -decimal.units : decimal.units;
    const scale = decimal.scale;
    const digits = absolute.toString().padStart(scale + 1, "0");
    const integerPart = scale === 0 ? digits : digits.slice(0, -scale) || "0";
    let fractionPart = scale === 0 ? "" : digits.slice(-scale);

    while (fractionPart.length > minimumFractionDigits && fractionPart.endsWith("0")) {
      fractionPart = fractionPart.slice(0, -1);
    }
    if (fractionPart.length < minimumFractionDigits) {
      fractionPart = fractionPart.padEnd(minimumFractionDigits, "0");
    }

    return `${negative ? "-" : ""}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`;
  }

  function parseStopVolume(rawValue) {
    if (typeof rawValue === "number" && !Number.isFinite(rawValue)) {
      throw new TypeError("目前跳停公升數必須是有效數字。");
    }

    const source = String(rawValue ?? "").trim();
    if (!source) throw new TypeError("請輸入目前跳停公升數。");
    if (!/^\d+(?:\.\d{1,2})?$/.test(source)) {
      throw new TypeError("目前跳停公升數必須是正數，且最多到小數點後兩位。");
    }

    const parsed = parseDecimal(source, {
      fieldName: "目前跳停公升數",
      allowZero: false,
    });
    const volumeHundredths = parsed.units * powerOfTen(2 - parsed.scale);
    if (volumeHundredths <= 0n) {
      throw new RangeError("目前跳停公升數必須大於 0 L。");
    }
    return volumeHundredths;
  }

  function resolveEffectiveUnitPrice({ prices, grade, mode, selfServiceDiscount }) {
    const normalizedGrade = String(grade);
    if (!GRADES.includes(normalizedGrade)) {
      throw new RangeError("請選擇 98、95 或 92 無鉛汽油。");
    }
    if (!Object.values(MODES).includes(mode)) {
      throw new RangeError("請選擇人工加油或自助加油。");
    }
    if (!prices || !Object.prototype.hasOwnProperty.call(prices, normalizedGrade)) {
      throw new TypeError(`找不到 ${normalizedGrade} 無鉛汽油牌價。`);
    }

    const manual = parseDecimal(prices[normalizedGrade], {
      fieldName: `${normalizedGrade} 無鉛汽油牌價`,
      allowZero: false,
    });
    if (manual.units <= 0n) {
      throw new RangeError(`${normalizedGrade} 無鉛汽油牌價必須大於 0 元。`);
    }

    const normalizedManual = normalizeDecimal(manual, 1);
    if (mode === MODES.MANUAL) {
      return {
        grade: normalizedGrade,
        mode,
        manual: normalizedManual,
        discount: normalizeDecimal({ units: 0n, scale: 1 }, 1),
        effective: normalizedManual,
      };
    }

    const discount = parseDecimal(selfServiceDiscount, {
      fieldName: "自助每公升優惠",
      allowZero: true,
    });
    if (discount.units < 0n) {
      throw new RangeError("自助每公升優惠不可為負數。");
    }

    const aligned = alignDecimals(normalizedManual, discount, 1);
    const effectiveUnits = aligned.leftUnits - aligned.rightUnits;
    if (effectiveUnits <= 0n) {
      throw new RangeError("自助有效單價必須大於 0 元。");
    }

    return {
      grade: normalizedGrade,
      mode,
      manual: normalizeDecimal(
        { units: aligned.leftUnits, scale: aligned.scale },
        1,
      ),
      discount: normalizeDecimal(
        { units: aligned.rightUnits, scale: aligned.scale },
        1,
      ),
      effective: normalizeDecimal(
        { units: effectiveUnits, scale: aligned.scale },
        1,
      ),
    };
  }

  function analyzeAmount(unitPrice, volumeHundredths) {
    if (!unitPrice || typeof unitPrice.units !== "bigint" || unitPrice.units <= 0n) {
      throw new TypeError("有效單價格式錯誤。");
    }
    if (typeof volumeHundredths !== "bigint" || volumeHundredths <= 0n) {
      throw new TypeError("公升數格式錯誤。");
    }

    const rawAmountUnits = unitPrice.units * volumeHundredths;
    const rawAmountScale = unitPrice.scale + 2;
    const denominator = powerOfTen(rawAmountScale);
    const fractionUnits = rawAmountUnits % denominator;
    const category = classifyFraction(fractionUnits, denominator);
    const roundedAmount = (rawAmountUnits * 2n + denominator) / (2n * denominator);

    return {
      rawAmountUnits,
      rawAmountScale,
      denominator,
      fractionUnits,
      category,
      qualifies: category !== null,
      roundedAmount,
      rawAmount: formatDecimal(
        { units: rawAmountUnits, scale: rawAmountScale },
        Math.max(3, rawAmountScale),
      ),
    };
  }

  function classifyFraction(fractionUnits, denominator) {
    const isRangeCandidate =
      fractionUnits * 10n >= denominator * 3n &&
      fractionUnits * 5n < denominator * 2n;
    if (isRangeCandidate) return CATEGORIES.RANGE;

    const isExactPointFourCandidate = fractionUnits * 5n === denominator * 2n;
    if (isExactPointFourCandidate) return CATEGORIES.EXACT_POINT_FOUR;

    return null;
  }

  function classifyUnroundedAmount(rawAmount) {
    const parsed = parseDecimal(rawAmount, {
      fieldName: "未進位金額",
      allowZero: true,
    });
    if (parsed.units < 0n) throw new RangeError("未進位金額不可為負數。");
    const denominator = powerOfTen(parsed.scale);
    const fractionUnits = parsed.units % denominator;
    const category = classifyFraction(fractionUnits, denominator);
    return {
      category,
      qualifies: category !== null,
      isRangeCandidate: category === CATEGORIES.RANGE,
      isExactPointFourCandidate: category === CATEGORIES.EXACT_POINT_FOUR,
      roundedAmount: (parsed.units * 2n + denominator) / (2n * denominator),
    };
  }

  function isExactPointFourCandidate(candidate) {
    return candidate?.category === CATEGORIES.EXACT_POINT_FOUR;
  }

  function ceilDivide(dividend, divisor) {
    return (dividend + divisor - 1n) / divisor;
  }

  function formatVolume(volumeHundredths) {
    return formatDecimal({ units: volumeHundredths, scale: 2 }, 2);
  }

  function validateSearchInput(input) {
    try {
      if (!input || typeof input !== "object") {
        throw new TypeError("缺少試算條件。");
      }
      const stopHundredths = parseStopVolume(input.stopVolume);
      const unitPrices = resolveEffectiveUnitPrice(input);
      const requestedCategoryLimit = input.categoryLimit ?? input.limit;
      const categoryLimit =
        requestedCategoryLimit === undefined
          ? CATEGORY_RESULT_LIMIT
          : Number(requestedCategoryLimit);
      if (!Number.isInteger(categoryLimit) || categoryLimit < 1 || categoryLimit > CATEGORY_RESULT_LIMIT) {
        throw new RangeError(`每組結果數量必須是 1 至 ${CATEGORY_RESULT_LIMIT} 的整數。`);
      }
      return { valid: true, error: "", stopHundredths, unitPrices, categoryLimit };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "試算條件無效。",
      };
    }
  }

  function findCandidates(input) {
    const validation = validateSearchInput(input);
    if (!validation.valid) throw new RangeError(validation.error);

    const { stopHundredths, unitPrices, categoryLimit } = validation;
    const unitPrice = unitPrices.effective;
    const denominator = powerOfTen(unitPrice.scale + 2);
    const minimumRawUnits = MIN_AMOUNT * denominator;
    const maximumRawUnits = MAX_AMOUNT * denominator;
    const stopRawUnits = unitPrice.units * stopHundredths;
    const requestedStart = stopHundredths + 1n;
    const firstInRange = ceilDivide(minimumRawUnits, unitPrice.units);
    const startHundredths = requestedStart > firstInRange ? requestedStart : firstInRange;
    const maximumHundredths = maximumRawUnits / unitPrice.units;
    const rangeCandidates = [];
    const exactPointFourCandidates = [];
    let searchedCount = 0;

    if (stopRawUnits <= maximumRawUnits && startHundredths <= maximumHundredths) {
      let target = startHundredths;
      while (
        target <= maximumHundredths &&
        (rangeCandidates.length < categoryLimit ||
          exactPointFourCandidates.length < categoryLimit)
      ) {
        searchedCount += 1;
        const amount = analyzeAmount(unitPrice, target);
        const needsRangeCandidates = rangeCandidates.length < categoryLimit;
        const needsExactPointFourCandidates =
          exactPointFourCandidates.length < categoryLimit;
        const acceptsCategory =
          (amount.category === CATEGORIES.RANGE && needsRangeCandidates) ||
          (amount.category === CATEGORIES.EXACT_POINT_FOUR &&
            needsExactPointFourCandidates);

        if (acceptsCategory) {
          const additionalHundredths = target - stopHundredths;
          const candidate = {
            category: amount.category,
            targetHundredths: target,
            additionalHundredths,
            targetVolume: formatVolume(target),
            additionalVolume: formatVolume(additionalHundredths),
            additionalMilliliters: (additionalHundredths * 10n).toString(),
            rawAmount: amount.rawAmount,
            roundedAmount: amount.roundedAmount.toString(),
          };
          if (amount.category === CATEGORIES.RANGE) {
            rangeCandidates.push(candidate);
          } else {
            exactPointFourCandidates.push(candidate);
          }
          target += 1n;
          continue;
        }

        // When range candidates are still needed, the next possible window
        // starts at .300. Once that group is full, the next useful point is the
        // exact .400 boundary. Jumping between these boundaries remains
        // equivalent to checking every 0.01 L value and guarantees progress.
        const wholeAmount = amount.rawAmountUnits / amount.denominator;
        const boundaryFraction = needsRangeCandidates
          ? (amount.denominator * 3n) / 10n
          : (amount.denominator * 2n) / 5n;
        const boundaryWholeAmount =
          amount.fractionUnits < boundaryFraction
            ? wholeAmount
            : wholeAmount + 1n;
        const candidateBoundaryRawUnits =
          boundaryWholeAmount * amount.denominator + boundaryFraction;
        const nextTarget = ceilDivide(candidateBoundaryRawUnits, unitPrice.units);
        target = nextTarget > target ? nextTarget : target + 1n;
      }
    }

    const combinedCandidates = [...rangeCandidates, ...exactPointFourCandidates]
      .sort((left, right) => {
        if (left.additionalHundredths < right.additionalHundredths) return -1;
        if (left.additionalHundredths > right.additionalHundredths) return 1;
        return 0;
      })
      .map((candidate, index) => {
        const { targetHundredths, additionalHundredths, ...displayCandidate } = candidate;
        return {
          rank: index + 1,
          ...displayCandidate,
          targetVolumeHundredths: targetHundredths.toString(),
          additionalVolumeHundredths: additionalHundredths.toString(),
        };
      });
    const resultLimitReached =
      rangeCandidates.length === categoryLimit &&
      exactPointFourCandidates.length === categoryLimit;
    const amountLimitReached = !resultLimitReached;
    const reason =
      stopRawUnits > maximumRawUnits
        ? "above-maximum"
        : resultLimitReached
          ? "result-limit"
          : "amount-limit";

    return {
      grade: unitPrices.grade,
      mode: unitPrices.mode,
      manualUnitPrice: formatDecimal(unitPrices.manual, 1),
      selfServiceDiscount: formatDecimal(unitPrices.discount, 1),
      effectiveUnitPrice: formatDecimal(unitPrices.effective, 1),
      stopVolume: formatVolume(stopHundredths),
      candidates: combinedCandidates,
      categoryCounts: {
        range: rangeCandidates.length,
        exactPointFour: exactPointFourCandidates.length,
      },
      categoryLimit,
      resultLimitReached,
      amountLimitReached,
      reason,
      searchedCount,
      minimumAmount: MIN_AMOUNT.toString(),
      maximumAmount: MAX_AMOUNT.toString(),
    };
  }

  return Object.freeze({
    GRADES,
    MODES,
    CATEGORIES,
    MIN_AMOUNT,
    MAX_AMOUNT,
    CATEGORY_RESULT_LIMIT,
    DEFAULT_RESULT_LIMIT,
    parseDecimal,
    parseStopVolume,
    resolveEffectiveUnitPrice,
    analyzeAmount,
    classifyUnroundedAmount,
    isExactPointFourCandidate,
    validateSearchInput,
    findCandidates,
  });
});



/*
 * Browser runtime loader
 * - A local Node server exposes api/prices and can refresh the official source.
 * - GitHub Pages has no server endpoint; the loader cleanly falls back to the
 *   validated static data snapshot published by the scheduled workflow.
 */
(function initCpcRuntimePriceLoader(globalScope) {
  "use strict";

  const priceSource = globalScope.CpcPriceData;
  const RUNTIME_ENDPOINT = "api/prices";
  /*
   * This is only a file:// safety net. It lets a downloaded copy open even
   * when a browser disallows fetch() for neighbouring JSON files. The normal
   * source of truth remains data/cpc-prices.json, which both GitHub Actions
   * and the local server update and validate.
   */
  const OFFLINE_FALLBACK_SNAPSHOT = Object.freeze({
    source: "內嵌離線備援牌價快照",
    sourceUrl: priceSource.OFFICIAL_SOURCE_URL,
    datasetUrl: priceSource.DATASET_URL,
    retrievedAt: "2026-09-19T15:53:12.833Z",
    effectiveDate: "2026-09-14",
    prices: Object.freeze({ 98: 34.7, 95: 32.7, 92: 31.2 }),
    products: Object.freeze({
      98: Object.freeze({
        productName: "98無鉛汽油",
        price: 34.7,
        effectiveDate: "2026-09-14",
        unit: "元/ 公升",
        deliveryLocation: "中油自營站",
        typeName: "汽柴油零售",
      }),
      95: Object.freeze({
        productName: "95無鉛汽油",
        price: 32.7,
        effectiveDate: "2026-09-14",
        unit: "元/ 公升",
        deliveryLocation: "中油自營站",
        typeName: "汽柴油零售",
      }),
      92: Object.freeze({
        productName: "92無鉛汽油",
        price: 31.2,
        effectiveDate: "2026-09-14",
        unit: "元/ 公升",
        deliveryLocation: "中油自營站",
        typeName: "汽柴油零售",
      }),
    }),
  });

  function offlineFallbackData() {
    const data = priceSource.validatePriceData(OFFLINE_FALLBACK_SNAPSHOT);
    data.runtimeMode = "offline";
    data.runtimeMessage = "瀏覽器無法讀取本機 JSON，已使用內嵌離線牌價快照。";
    return data;
  }

  async function loadFromLocalServer(options = {}) {
    if (
      typeof globalScope.location === "undefined" ||
      !/^https?:$/.test(globalScope.location.protocol) ||
      typeof globalScope.fetch !== "function"
    ) {
      return null;
    }

    const refresh = options.force ? "force" : "page";
    try {
      const response = await globalScope.fetch(
        RUNTIME_ENDPOINT + "?refresh=" + encodeURIComponent(refresh),
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );
      if (!response || !response.ok) return null;

      const payload = await response.json();
      const data = priceSource.validatePriceData(payload);
      data.runtimeMode = payload.runtime && payload.runtime.mode === "stale" ? "stale" : "local";
      data.runtimeMessage = payload.runtime && payload.runtime.message ? payload.runtime.message : "";
      return data;
    } catch (_error) {
      return null;
    }
  }

  async function load(options = {}) {
    const runtimeData = await loadFromLocalServer(options);
    if (runtimeData) return runtimeData;

    try {
      const staticData = await priceSource.loadPriceData(options);
      staticData.runtimeMode = "static";
      staticData.runtimeMessage = "已讀取 GitHub Pages 已發布的牌價快照。";
      return staticData;
    } catch (error) {
      if (
        typeof globalScope.location !== "undefined" &&
        globalScope.location.protocol === "file:"
      ) {
        return offlineFallbackData();
      }
      throw error;
    }
  }

  globalScope.CpcRuntimePrices = Object.freeze({
    RUNTIME_ENDPOINT,
    load,
    offlineFallbackData,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);


(function initApp() {
  "use strict";

  if (typeof document === "undefined" || !document.body || document.body.dataset.page !== "ranking") return;

  const calculator = globalThis.CpcCalculator;
  const priceSource = globalThis.CpcPriceData;
  if (!calculator || !priceSource) {
    throw new Error("計算核心未載入，請確認 calculator.js、price-data.js 與 index.html 位於同一資料夾。" );
  }

  const grades = ["98", "95", "92"];
  const themeStorageKey = calculator.THEME_STORAGE_KEY;
  const formatters = {
    money: new Intl.NumberFormat("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    liters: new Intl.NumberFormat("zh-TW", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }),
    rate: new Intl.NumberFormat("zh-TW", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }),
    unitPrice: new Intl.NumberFormat("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    points: new Intl.NumberFormat("zh-TW", {
      maximumFractionDigits: 0,
    }),
    detail: new Intl.NumberFormat("zh-TW", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 9,
    }),
    dateTime: new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Taipei",
    }),
  };

  const elements = {
    form: document.querySelector("#calculator-form"),
    results: document.querySelector("#results"),
    bestSummary: document.querySelector("#best-summary"),
    rankingTables: document.querySelector("#ranking-tables"),
    comparisonTable: document.querySelector("#comparison-table"),
    chart: document.querySelector("#reward-chart"),
    validationSummary: document.querySelector("#validation-summary"),
    activityWarning: document.querySelector("#activity-warning"),
    lastUpdated: document.querySelector("#last-updated"),
    priceSyncStatus: document.querySelector("#price-sync-status"),
    live: document.querySelector("#calculation-live"),
    updatePriceButton: document.querySelector("#update-latest-price"),
    themeToggle: document.querySelector("#theme-toggle"),
  };

  const fieldMap = {
    principal: "principal",
    rechargeRate: "recharge-rate",
    selfServiceDiscount: "self-discount",
    cardType: "card-type",
    ctbcPointValue: "ctbc-point-value",
    vipPointsPerDollar: "vip-points-per-dollar",
    vipFuelPointValue: "vip-fuel-value",
    vipPremiumPointValue: "vip-premium-value",
  };

  let snapshot = null;
  let chartGrade = "98";
  let rankingGrade = "98";
  let renderFrame = null;
  let currentPrices = null;
  let currentPriceData = null;
  const storage = getStorage();

  function getStorage() {
    try {
      return globalThis.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function valueOf(id) {
    return document.getElementById(id).value;
  }

  function percentInputToRate(value) {
    if (typeof value === "string" && value.trim() === "") return Number.NaN;
    return Number(value) / 100;
  }

  function readForm() {
    return {
      prices: currentPrices,
      config: {
        principal: valueOf("principal"),
        rechargeRate: percentInputToRate(valueOf("recharge-rate")),
        selfServiceDiscount: valueOf("self-discount"),
        cardType: valueOf("card-type"),
        ctbcPointValue: valueOf("ctbc-point-value"),
        vipPointsPerDollar: valueOf("vip-points-per-dollar"),
        vipFuelPointValue: valueOf("vip-fuel-value"),
        vipPremiumPointValue: valueOf("vip-premium-value"),
      },
    };
  }

  function setInputValue(id, value) {
    document.getElementById(id).value = String(value);
  }

  function populateForm(state) {
    setInputValue("principal", state.config.principal);
    setInputValue("recharge-rate", state.config.rechargeRate * 100);
    setInputValue("self-discount", state.config.selfServiceDiscount);
    setInputValue("card-type", state.config.cardType);
    setInputValue("ctbc-point-value", state.config.ctbcPointValue);
    setInputValue("vip-points-per-dollar", state.config.vipPointsPerDollar);
    setInputValue("vip-fuel-value", state.config.vipFuelPointValue);
    setInputValue("vip-premium-value", state.config.vipPremiumPointValue);
  }

  function money(value) {
    return `${formatters.money.format(value)} 元`;
  }

  function price(value) {
    return `${formatters.unitPrice.format(value)} 元`;
  }

  function liters(value) {
    return `${formatters.liters.format(value)} L`;
  }

  function rate(value) {
    return `${formatters.rate.format(value)}%`;
  }

  function percentagePoints(value, signed) {
    const normalized = Math.abs(value) < 0.0005 ? 0 : value;
    const sign = signed && normalized > 0 ? "+" : "";
    return `${sign}${formatters.rate.format(normalized)} 個百分點`;
  }

  function points(value) {
    return `${formatters.points.format(value)} 點`;
  }

  function detailValue(value, unit) {
    const formatted = formatters.detail.format(value);
    if (unit === "%") return `${formatted}%`;
    return `${formatted} ${unit}`;
  }

  function formatMaybe(value, formatter, fallback) {
    return value === null || value === undefined ? fallback || "—" : formatter(value);
  }

  function clearValidation() {
    Object.entries(fieldMap).forEach(([field, id]) => {
      document.getElementById(id).removeAttribute("aria-invalid");
      const error = document.getElementById(`${field}-error`);
      if (error) error.textContent = "";
    });

    elements.validationSummary.hidden = true;
    elements.validationSummary.textContent = "";
  }

  function showValidation(validation) {
    clearValidation();
    const messages = [];

    validation.configErrors.forEach(({ field, message }) => {
      const inputId = fieldMap[field];
      if (inputId) document.getElementById(inputId).setAttribute("aria-invalid", "true");
      const error = document.getElementById(`${field}-error`);
      if (error) error.textContent = message;
      messages.push(message);
    });

    if (messages.length) {
      elements.validationSummary.textContent = `請修正後再計算：${messages.join(" ")}`;
      elements.validationSummary.hidden = false;
    }
  }

  function showActivityWarnings(warnings) {
    if (!warnings.length) {
      elements.activityWarning.hidden = true;
      elements.activityWarning.textContent = "";
      return;
    }
    elements.activityWarning.textContent = `提醒：${warnings.join("；")}`;
    elements.activityWarning.hidden = false;
  }

  function calculateAndRender(options) {
    const announce = !options || options.announce !== false;
    if (!currentPrices) {
      elements.results.hidden = true;
      if (announce) elements.live.textContent = "尚未取得台灣中油官方油價，請稍後再試。";
      return false;
    }
    const formState = readForm();
    const validation = calculator.validateInputs(formState.prices, formState.config);
    showValidation(validation);
    showActivityWarnings(validation.warnings);

    if (!validation.valid) {
      elements.results.hidden = true;
      if (announce) elements.live.textContent = "輸入有誤，請查看欄位提示。";
      return false;
    }

    snapshot = calculator.calculateAll(formState.prices, formState.config);
    renderSnapshot(snapshot);
    calculator.savePreferences(storage, {
      prices: snapshot.prices,
      config: snapshot.config,
      priceMeta: currentPriceData,
    });
    elements.results.hidden = false;

    if (announce) {
      elements.live.textContent = `計算完成。98、95、92 無鉛目前第一名依序為${grades
        .map((grade) => snapshot.fuels[grade].winner.shortName)
        .join("、")}。`;
    }
    return true;
  }

  function formatSyncTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : formatters.dateTime.format(date);
  }

  function priceMetaFromData(data) {
    if (!data) return null;
    return {
      effectiveDate: data.effectiveDate || "",
      retrievedAt: data.retrievedAt || "",
      source: data.source || "台灣中油政府資料開放平台",
      sourceUrl: data.sourceUrl || priceSource.OFFICIAL_SOURCE_URL,
    };
  }

  function renderPriceCards(data) {
    currentPriceData = data || null;
    currentPrices = data ? { ...data.prices } : null;
    grades.forEach((grade) => {
      const output = document.getElementById(`price-${grade}`);
      const effective = document.getElementById(`price-${grade}-effective`);
      if (!data) {
        output.textContent = "—";
        effective.textContent = "牌價生效日期：—";
        return;
      }
      output.textContent = formatters.unitPrice.format(data.prices[grade]);
      effective.textContent = `牌價生效日期：${data.effectiveDate ? priceSource.formatEffectiveDate(data.effectiveDate) : "上一筆有效資料"}`;
    });

    if (data && data.retrievedAt) {
      const formatted = formatSyncTime(data.retrievedAt);
      elements.lastUpdated.innerHTML = `<time datetime="${new Date(data.retrievedAt).toISOString()}">最後同步：${formatted}</time>`;
    } else {
      elements.lastUpdated.textContent = "最後同步：上一筆有效資料（時間未提供）";
    }
  }

  function setPriceSyncStatus(message, kind = "") {
    elements.priceSyncStatus.textContent = message;
    elements.priceSyncStatus.dataset.state = kind;
  }

  function staleDataFromState(state) {
    if (!state || !state.prices) return null;
    return {
      source: state.priceMeta?.source || "上一筆有效資料",
      sourceUrl: state.priceMeta?.sourceUrl || priceSource.OFFICIAL_SOURCE_URL,
      datasetUrl: priceSource.DATASET_URL,
      retrievedAt: state.priceMeta?.retrievedAt || "",
      effectiveDate: state.priceMeta?.effectiveDate || "",
      prices: { ...state.prices },
    };
  }

  function getConfigForSync(previousState) {
    const rawConfig = readForm().config;
    const validation = calculator.validateConfiguration(rawConfig);
    if (validation.valid) return calculator.normalizeConfiguration(rawConfig);
    return previousState?.config || calculator.getDefaultState().config;
  }

  async function loadOfficialPrices({ announce = true, force = false } = {}) {
    const previousState = calculator.loadPreferences(storage);
    const knownEffectiveDate = previousState?.priceMeta?.effectiveDate || "";
    elements.updatePriceButton.disabled = true;
    elements.updatePriceButton.setAttribute("aria-busy", "true");
    setPriceSyncStatus("正在讀取目前已發布的官方油價資料…", "loading");

    try {
      const data = await globalThis.CpcRuntimePrices.load({ knownEffectiveDate, force });
      const state = {
        prices: { ...data.prices },
        config: getConfigForSync(previousState),
        priceMeta: priceMetaFromData(data),
      };
      calculator.savePreferences(storage, state);
      populateForm(state);
      renderPriceCards(data);
      const syncMessage =
        data.runtimeMode === "local"
          ? `已向台灣中油官方來源重新查詢牌價，生效日 ${priceSource.formatEffectiveDate(data.effectiveDate)}。`
          : data.runtimeMode === "stale"
            ? `官方來源暫時無法更新，已安全保留上一筆有效牌價，生效日 ${priceSource.formatEffectiveDate(data.effectiveDate)}。`
            : data.runtimeMode === "offline"
              ? `目前以內嵌離線牌價快照計算，生效日 ${priceSource.formatEffectiveDate(data.effectiveDate)}；若要同步，請使用本機伺服器或 GitHub Pages。`
              : `已載入 GitHub Pages 已發布的官方牌價快照，生效日 ${priceSource.formatEffectiveDate(data.effectiveDate)}。`;
      setPriceSyncStatus(
        syncMessage,
        data.runtimeMode === "stale" || data.runtimeMode === "offline" ? "warning" : "success",
      );
      calculateAndRender({ announce: false });
      if (announce) elements.live.textContent = "已重新取得目前已發布的台灣中油官方油價，回饋結果已更新。";
      return true;
    } catch (error) {
      const staleData = staleDataFromState(previousState);
      if (staleData) {
        populateForm(previousState);
        renderPriceCards(staleData);
        setPriceSyncStatus(
          `官方油價同步失敗，目前仍使用上一筆有效資料。${error instanceof Error ? `（${error.message}）` : ""}`,
          "warning",
        );
        calculateAndRender({ announce: false });
        if (announce) elements.live.textContent = "官方油價同步失敗，已保留上一筆有效資料。";
      } else {
        renderPriceCards(null);
        elements.results.hidden = true;
        setPriceSyncStatus(
          `目前無法取得官方油價，請稍後再試。${error instanceof Error ? `（${error.message}）` : ""}`,
          "error",
        );
        if (announce) elements.live.textContent = "目前無法取得台灣中油官方油價。";
      }
      return false;
    } finally {
      elements.updatePriceButton.disabled = false;
      elements.updatePriceButton.removeAttribute("aria-busy");
    }
  }

  function scheduleCalculation() {
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      calculateAndRender({ announce: false });
    });
  }

  function renderSnapshot(data) {
    renderBestSummary(data);
    renderChart(data, chartGrade);
    renderRankings(data, rankingGrade);
    renderComparison(data);
  }

  function renderBestSummary(data) {
    elements.bestSummary.innerHTML = grades
      .map((grade) => {
        const fuel = data.fuels[grade];
        const winner = fuel.winner;
        const gap = fuel.winnerAdvantage;
        return `
          <article class="best-card grade-${grade}">
            <div class="best-topline">
              <div class="grade-label"><strong>${grade}</strong><span>無鉛</span></div>
              <span class="winner-badge">目前最划算</span>
            </div>
            <h3>${winner.name}</h3>
            <div class="best-rate">
              <div><span>精確有效回饋率</span><strong>${rate(winner.preciseRate)}</strong></div>
              <div><small>總回饋</small><b>${money(winner.totalReward)}</b></div>
            </div>
            <div class="best-meta">
              <div><span>有效每公升成本</span><strong>${price(winner.effectiveCostPerLiter)}</strong></div>
              <div><span>可加公升數</span><strong>${liters(winner.liters)}</strong></div>
            </div>
            <p class="advantage-line">比第二名多省 <b>${money(gap.amount)}</b>・高 <b>${percentagePoints(gap.percentagePoints)}</b>${gap.almostTie ? "（幾乎相同）" : ""}</p>
          </article>
        `;
      })
      .join("");
  }

  const rankingHeaders = [
    "排名",
    "方法",
    "人工／自助",
    "牌價",
    "實際加油單價",
    "實際支出",
    "捷利卡可用餘額",
    "可加公升數",
    "捷利卡紅利金",
    "自助折讓",
    "中信紅利點數",
    "中信紅利價值",
    "VIP 點數",
    "VIP 點數估值方式",
    "VIP 點數價值",
    "總回饋",
    "總等值",
    "廣告式回饋率",
    "精確有效回饋率",
    "精確－廣告差異",
    "有效每公升成本",
    "計算過程",
  ];

  function renderRankings(data, grade) {
    const fuel = data.fuels[grade];
    elements.rankingTables.innerHTML = `
      <article class="ranking-panel" id="ranking-panel-${grade}" aria-labelledby="ranking-${grade}-title">
        <header class="ranking-panel-header">
          <div class="ranking-panel-title">
            <span class="grade-orb">${grade}</span>
            <div><h3 id="ranking-${grade}-title">${grade} 無鉛完整排名</h3><p>牌價 ${price(fuel.price)}・自助價 ${price(fuel.selfServicePrice)}</p></div>
          </div>
          <div class="ranking-gap"><strong>冠亞差 ${money(fuel.winnerAdvantage.amount)}</strong>${percentagePoints(fuel.winnerAdvantage.percentagePoints)}</div>
        </header>
        ${renderDesktopRanking(fuel)}
        ${renderMobileRanking(fuel)}
      </article>
    `;
  }

  function tieBadge(method) {
    return method.almostTieWithPrevious || method.almostTieWithNext
      ? '<span class="near-badge">幾乎相同</span>'
      : "";
  }

  function renderDesktopRanking(fuel) {
    const head = rankingHeaders.map((label) => `<th scope="col">${label}</th>`).join("");
    const body = fuel.ranking
      .map((method) => {
        const detailsId = `formula-${fuel.grade}-${method.id}`;
        return `
          <tr class="main-row ${method.rank === 1 ? "winner-row" : ""}">
            <td><span class="rank-badge ${method.rank === 1 ? "first" : ""}">${method.rank}</span></td>
            <td class="method-cell"><strong>${method.name}</strong><small>方法 ${method.id}・${method.paymentMode}</small>${method.rank === 1 ? '<span class="winner-badge">目前最划算</span>' : tieBadge(method)}</td>
            <td><span class="mode-pill ${method.serviceMode === "自助" ? "self" : ""}">${method.serviceMode}</span></td>
            <td>${price(method.listPrice)}</td>
            <td>${price(method.actualUnitPrice)}</td>
            <td>${money(method.actualSpend)}</td>
            <td>${formatMaybe(method.jieliBalance, money)}</td>
            <td>${liters(method.liters)}</td>
            <td>${money(method.jieliBonus)}</td>
            <td>${money(method.selfServiceSavings)}</td>
            <td>${points(method.ctbcPoints)}</td>
            <td>${money(method.ctbcValue)}</td>
            <td>${points(method.vipPoints)}</td>
            <td class="method-cell">${method.vipValuationLabel}</td>
            <td>${money(method.vipValue)}</td>
            <td class="reward-cell">${money(method.totalReward)}</td>
            <td>${money(method.totalEquivalent)}</td>
            <td>${rate(method.advertisedRate)}</td>
            <td class="rate-cell">${rate(method.preciseRate)}</td>
            <td>${percentagePoints(method.rateDifference, true)}</td>
            <td class="cost-cell">${price(method.effectiveCostPerLiter)}</td>
            <td><button class="formula-button" type="button" data-formula-target="${detailsId}" aria-controls="${detailsId}" aria-expanded="false">查看計算過程</button></td>
          </tr>
          <tr class="formula-row" id="${detailsId}" hidden><td colspan="${rankingHeaders.length}">${renderFormulaContent(method)}</td></tr>
        `;
      })
      .join("");

    return `
      <div class="table-scroll desktop-ranking" tabindex="0" aria-label="可左右捲動查看 ${fuel.grade} 無鉛完整排名表">
        <table class="ranking-table">
          <caption>${fuel.grade} 無鉛六種加油方法完整計算與排名</caption>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function mobileMetric(label, value) {
    return `<div class="mobile-metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function renderMobileRanking(fuel) {
    return `
      <div class="mobile-ranking" aria-label="${fuel.grade} 無鉛行動版排名卡片">
        ${fuel.ranking
          .map(
            (method) => `
              <article class="mobile-method-card method-${method.id} ${method.rank === 1 ? "winner" : ""}">
                <div class="mobile-card-head">
                  <span class="rank-badge ${method.rank === 1 ? "first" : ""}">${method.rank}</span>
                  <div><h4>${method.name}</h4><p><span class="mode-pill ${method.serviceMode === "自助" ? "self" : ""}">${method.serviceMode}</span>${method.rank === 1 ? '<span class="winner-badge">目前最划算</span>' : tieBadge(method)}</p></div>
                  <div class="mobile-highlight"><span>精確回饋率</span><strong>${rate(method.preciseRate)}</strong></div>
                </div>
                <div class="mobile-metrics">
                  ${mobileMetric("牌價", price(method.listPrice))}
                  ${mobileMetric("實際加油單價", price(method.actualUnitPrice))}
                  ${mobileMetric("實際支出", money(method.actualSpend))}
                  ${mobileMetric("捷利卡可用餘額", formatMaybe(method.jieliBalance, money))}
                  ${mobileMetric("可加公升數", liters(method.liters))}
                  ${mobileMetric("捷利卡紅利金", money(method.jieliBonus))}
                  ${mobileMetric("自助折讓", money(method.selfServiceSavings))}
                  ${mobileMetric("中信紅利點數", points(method.ctbcPoints))}
                  ${mobileMetric("中信紅利價值", money(method.ctbcValue))}
                  ${mobileMetric("VIP 點數", points(method.vipPoints))}
                  ${mobileMetric("VIP 估值方式", method.vipValuationLabel)}
                  ${mobileMetric("VIP 點數價值", money(method.vipValue))}
                  ${mobileMetric("總回饋", money(method.totalReward))}
                  ${mobileMetric("總等值", money(method.totalEquivalent))}
                  ${mobileMetric("廣告式回饋率", rate(method.advertisedRate))}
                  ${mobileMetric("精確有效回饋率", rate(method.preciseRate))}
                  ${mobileMetric("精確－廣告差異", percentagePoints(method.rateDifference, true))}
                  ${mobileMetric("有效每公升成本", price(method.effectiveCostPerLiter))}
                </div>
                <details class="mobile-formula"><summary>查看計算過程</summary>${renderFormulaContent(method)}</details>
              </article>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderFormulaContent(method) {
    const steps = method.formulaSteps
      .map(
        (step) => `
          <div class="formula-step">
            <dt>${step.label}</dt>
            <code>${step.expression}</code>
            <dd>${detailValue(step.value, step.unit)}</dd>
          </div>
        `,
      )
      .join("");

    const differenceReason =
      method.serviceMode === "自助"
        ? "廣告式回饋率以 d ÷ 牌價 P 直接相加；精確算法則先用自助價 P − d 算出實際公升數，再把真正的自助折讓換算回同一筆本金。"
        : method.usesRecharge
          ? "廣告式回饋率把每元 VIP 點數估值視為本金 A 的固定比例；精確算法按實際可用餘額 B 的整數消費金額產生 VIP 點數，因此會受到儲值紅利與 floor 取整影響。"
          : "廣告式回饋率把每元 VIP 點數估值當成連續比例；精確算法依 floor(A) 取整後給點，本金不是整數時可能出現細微差異。";

    return `
      <div class="formula-content">
        <dl class="formula-steps">${steps}</dl>
        <aside class="formula-note">
          <strong>為什麼和廣告式百分比不同？</strong>
          <p>${differenceReason}</p>
          <p>內部計算保留完整精度；此處最多顯示 9 位小數，表格才依金額、點數、公升與百分比分別四捨五入。</p>
          ${method.crossCheckTotal !== null ? `<p><strong>交叉驗證：</strong>另一公式與逐項加總的差為 ${detailValue(method.crossCheckDifference, "元")}，在浮點誤差範圍內一致。</p>` : ""}
        </aside>
      </div>
    `;
  }

  function renderComparison(data) {
    const firstHeader = grades.map((grade) => `<th class="grade-group" scope="colgroup" colspan="4">${grade} 無鉛</th>`).join("");
    const secondHeader = grades.map(() => "<th scope=\"col\">排名</th><th scope=\"col\">總回饋</th><th scope=\"col\">精確回饋率</th><th scope=\"col\">有效每公升成本</th>").join("");
    const rows = calculator.METHOD_META.map((meta) => {
      const fuelCells = grades
        .map((grade) => {
          const method = data.fuels[grade].ranking.find((item) => item.id === meta.id);
          return `
            <td class="comparison-rank ${method.rank === 1 ? "first" : ""}">第 ${method.rank} 名</td>
            <td class="reward-cell">${money(method.totalReward)}</td>
            <td class="rate-cell">${rate(method.preciseRate)}</td>
            <td>${price(method.effectiveCostPerLiter)}</td>
          `;
        })
        .join("");
      return `<tr><td><strong>方法 ${meta.id}</strong><br>${meta.name}</td>${fuelCells}</tr>`;
    }).join("");

    elements.comparisonTable.innerHTML = `
      <table class="comparison-table">
        <caption>六種加油方法在 98、95、92 無鉛的排名、總回饋、精確回饋率與有效每公升成本</caption>
        <thead><tr><th scope="col" rowspan="2">比較方法</th>${firstHeader}</tr><tr>${secondHeader}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderChart(data, grade) {
    const fuel = data.fuels[grade];
    const maximum = Math.max(...fuel.ranking.map((method) => method.preciseRate)) * 1.08;
    const ticks = [0, 0.25, 0.5, 0.75, 1]
      .map((fraction) => `<span>${formatters.rate.format(maximum * fraction)}%</span>`)
      .join("");
    const bars = fuel.ranking
      .map((method) => {
        const width = maximum === 0 ? 0 : (method.preciseRate / maximum) * 100;
        return `
          <div class="bar-row method-${method.id}" aria-label="第 ${method.rank} 名，${method.name}，精確有效回饋率 ${rate(method.preciseRate)}">
            <div class="bar-label"><strong>${method.shortName}</strong><span>第 ${method.rank} 名・方法 ${method.id}</span></div>
            <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width: ${width}%"></div></div>
            <div class="bar-value">${rate(method.preciseRate)}</div>
          </div>
        `;
      })
      .join("");

    elements.chart.innerHTML = `
      <div class="chart-scale"><span>${grade} 無鉛六方案</span><div class="chart-ticks">${ticks}</div><span>回饋率</span></div>
      <div class="bar-chart" role="img" aria-label="${grade} 無鉛六種方法精確有效回饋率長條圖">${bars}</div>
    `;
  }

  function handleFormulaToggle(button) {
    const target = document.getElementById(button.dataset.formulaTarget);
    if (!target) return;
    const willOpen = target.hidden;
    target.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
    button.textContent = willOpen ? "收合計算過程" : "查看計算過程";
  }

  function loadTheme() {
    let theme = "auto";
    try {
      const saved = storage && storage.getItem(themeStorageKey);
      if (["auto", "light", "dark"].includes(saved)) theme = saved;
    } catch (_error) {
      theme = "auto";
    }
    applyTheme(theme);
  }

  function applyTheme(theme) {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    elements.themeToggle.dataset.theme = theme;
    elements.themeToggle.querySelector(".theme-label").textContent =
      theme === "auto" ? "自動" : theme === "light" ? "淺色" : "深色";
    elements.themeToggle.querySelector(".theme-icon").textContent =
      theme === "auto" ? "◐" : theme === "light" ? "☀" : "☾";
    elements.themeToggle.setAttribute(
      "aria-label",
      `目前為${theme === "auto" ? "跟隨系統" : theme === "light" ? "淺色" : "深色"}模式，按下可切換`,
    );
  }

  function cycleTheme() {
    const current = elements.themeToggle.dataset.theme || "auto";
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    applyTheme(next);
    try {
      if (storage) storage.setItem(themeStorageKey, next);
    } catch (_error) {
      // 儲存遭瀏覽器停用時仍可在本次瀏覽切換主題。
    }
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculateAndRender({ announce: true });
  });

  elements.form.addEventListener("input", (event) => {
    if (event.target.matches("input")) scheduleCalculation();
  });

  elements.form.addEventListener("change", (event) => {
    if (event.target.matches("input, select")) calculateAndRender({ announce: false });
  });

  elements.updatePriceButton.addEventListener("click", () => {
    loadOfficialPrices({ announce: true, force: true });
  });

  elements.rankingTables.addEventListener("click", (event) => {
    const button = event.target.closest("[data-formula-target]");
    if (button) handleFormulaToggle(button);
  });

  document.querySelectorAll("[data-chart-grade]").forEach((button) => {
    button.addEventListener("click", () => {
      chartGrade = button.dataset.chartGrade;
      document.querySelectorAll("[data-chart-grade]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      if (snapshot) renderChart(snapshot, chartGrade);
    });
  });

  document.querySelectorAll("[data-ranking-grade]").forEach((button) => {
    button.addEventListener("click", () => {
      rankingGrade = button.dataset.rankingGrade;
      document.querySelectorAll("[data-ranking-grade]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      if (snapshot) renderRankings(snapshot, rankingGrade);
      elements.live.textContent = `已切換為 ${rankingGrade} 無鉛汽油完整排名。`;
    });
  });

  elements.themeToggle.addEventListener("click", cycleTheme);

  globalThis.addEventListener("pagehide", () => {
    if (renderFrame !== null) {
      globalThis.cancelAnimationFrame(renderFrame);
      renderFrame = null;
      calculateAndRender({ announce: false });
    }
  });

  async function initialize() {
    const initialState = calculator.loadPreferences(storage) || calculator.getDefaultState();
    loadTheme();
    populateForm(initialState);
    elements.results.hidden = true;
    await loadOfficialPrices({ announce: false });
  }

  initialize();
})();


(function initRoundingPage() {
  "use strict";

  if (typeof document === "undefined" || !document.body || document.body.dataset.page !== "rounding") return;

  const calculator = globalThis.CpcCalculator;
  const priceSource = globalThis.CpcPriceData;
  const roundingCalculator = globalThis.CpcRoundingCalculator;
  if (!calculator || !priceSource || !roundingCalculator) {
    throw new Error("試算核心未載入，請確認 calculator.js、price-data.js 與 rounding-calculator.js 位於同一資料夾。");
  }

  const elements = {
    app: document.querySelector("#rounding-app"),
    missingState: document.querySelector("#missing-price-state"),
    form: document.querySelector("#rounding-form"),
    priceSummary: document.querySelector("#rounding-price-summary"),
    stopVolume: document.querySelector("#stop-volume"),
    stopVolumeError: document.querySelector("#stop-volume-error"),
    resultStatus: document.querySelector("#rounding-result-status"),
    resultNote: document.querySelector("#rounding-result-note"),
    emptyState: document.querySelector("#rounding-empty-state"),
    results: document.querySelector("#rounding-results"),
    themeToggle: document.querySelector("#theme-toggle"),
  };

  const integerFormatter = new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
  });
  const storage = getStorage();
  let sharedState = null;
  let volumeTouched = false;
  let stateLoadPromise = null;

  function getStorage() {
    try {
      return globalThis.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function selectedValue(name) {
    const selected = elements.form.querySelector(`[name="${name}"]:checked`);
    return selected ? selected.value : "";
  }

  function formatExactNumber(value) {
    const [integerPart, fractionPart] = String(value).split(".");
    const groupedInteger = integerFormatter.format(Number(integerPart));
    return fractionPart === undefined ? groupedInteger : `${groupedInteger}.${fractionPart}`;
  }

  function formatMoney(value) {
    return `NT$${formatExactNumber(value)}`;
  }

  function getCurrentInput() {
    return {
      prices: sharedState.prices,
      selfServiceDiscount: sharedState.config.selfServiceDiscount,
      grade: selectedValue("fuel-grade"),
      mode: selectedValue("fuel-mode"),
      stopVolume: elements.stopVolume.value,
    };
  }

  function setVolumeError(message) {
    elements.stopVolumeError.textContent = message;
    if (message) elements.stopVolume.setAttribute("aria-invalid", "true");
    else elements.stopVolume.removeAttribute("aria-invalid");
  }

  function clearResults(message) {
    elements.results.replaceChildren();
    elements.resultNote.hidden = true;
    elements.resultNote.textContent = "";
    elements.emptyState.hidden = false;
    elements.emptyState.querySelector("p").textContent = message;
  }

  function resolveCurrentPrice() {
    return roundingCalculator.resolveEffectiveUnitPrice({
      prices: sharedState.prices,
      selfServiceDiscount: sharedState.config.selfServiceDiscount,
      grade: selectedValue("fuel-grade"),
      mode: selectedValue("fuel-mode"),
    });
  }

  function updatePriceSummary() {
    if (!sharedState) return;
    try {
      const unitPrice = resolveCurrentPrice();
      const grade = unitPrice.grade;
      const details = getPriceStrings(unitPrice);
      if (unitPrice.mode === roundingCalculator.MODES.MANUAL) {
        elements.priceSummary.innerHTML = `
          <span>${grade} 無鉛汽油</span>
          <strong>人工加油：${formatMoney(details.manual)}／L</strong>
          <small>採用台灣中油官方牌價${sharedState.priceMeta?.effectiveDate ? `，生效日 ${priceSource.formatEffectiveDate(sharedState.priceMeta.effectiveDate)}` : "（上一筆有效資料）"}</small>
        `;
      } else {
        elements.priceSummary.innerHTML = `
          <span>${grade} 無鉛汽油</span>
          <strong>自助加油：${formatMoney(details.effective)}／L</strong>
          <small>原價 ${formatMoney(details.manual)}／L－自助優惠 ${formatMoney(details.discount)}／L＝自助價 ${formatMoney(details.effective)}／L；${sharedState.priceMeta?.effectiveDate ? `牌價生效日 ${priceSource.formatEffectiveDate(sharedState.priceMeta.effectiveDate)}` : "目前使用上一筆有效資料"}</small>
        `;
      }
    } catch (error) {
      elements.priceSummary.textContent = error instanceof Error ? error.message : "無法取得目前單價。";
    }
  }

  function decimalToString(decimal, minimumFractionDigits = 1) {
    const negative = decimal.units < 0n;
    const absolute = negative ? -decimal.units : decimal.units;
    const digits = absolute.toString().padStart(decimal.scale + 1, "0");
    const integerPart = decimal.scale === 0 ? digits : digits.slice(0, -decimal.scale) || "0";
    let fractionPart = decimal.scale === 0 ? "" : digits.slice(-decimal.scale);
    while (fractionPart.length > minimumFractionDigits && fractionPart.endsWith("0")) {
      fractionPart = fractionPart.slice(0, -1);
    }
    fractionPart = fractionPart.padEnd(minimumFractionDigits, "0");
    return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
  }

  function getPriceStrings(unitPrice) {
    if (unitPrice.mode === roundingCalculator.MODES.MANUAL) {
      const discount = roundingCalculator.parseDecimal(sharedState.config.selfServiceDiscount, {
        fieldName: "自助每公升優惠",
      });
      return {
        manual: decimalToString(unitPrice.manual),
        discount: decimalToString(discount),
        effective: decimalToString(unitPrice.effective),
      };
    }
    return {
      manual: decimalToString(unitPrice.manual),
      discount: decimalToString(unitPrice.discount),
      effective: decimalToString(unitPrice.effective),
    };
  }

  function formatCategorySummary(result) {
    return `小數部分 0.3（含）至 0.4（不含）共 ${result.categoryCounts.range} 項；小數部分精確等於 0.4 共 ${result.categoryCounts.exactPointFour} 項`;
  }

  function renderResults(result) {
    elements.emptyState.hidden = true;
    elements.results.innerHTML = result.candidates
      .map(
        (candidate) => `
          <li class="rounding-result-card${candidate.rank === 1 ? " is-first" : ""}" data-category="${candidate.category}">
            <header>
              <span>第 ${candidate.rank} 項</span>
              <strong>${candidate.targetVolume} L</strong>
            </header>
            <dl>
              <div>
                <dt>還需增加</dt>
                <dd>${candidate.additionalVolume} L <small>（${integerFormatter.format(BigInt(candidate.additionalMilliliters))} mL）</small></dd>
              </div>
              <div class="result-raw-amount${
                roundingCalculator.isExactPointFourCandidate(candidate)
                  ? " result-raw-amount--highlight"
                  : ""
              }">
                <dt>未進位金額</dt>
                <dd>${formatMoney(candidate.rawAmount)}</dd>
              </div>
              <div>
                <dt>四捨五入後</dt>
                <dd class="rounded-amount">${formatMoney(candidate.roundedAmount)}</dd>
              </div>
            </dl>
          </li>
        `,
      )
      .join("");

    if (
      !result.resultLimitReached &&
      result.amountLimitReached
    ) {
      elements.resultNote.hidden = false;
      elements.resultNote.textContent = `已到達 NT$3,000 金額上限，目前找到 ${result.candidates.length} 項結果：${formatCategorySummary(result)}。`;
    } else {
      elements.resultNote.hidden = true;
      elements.resultNote.textContent = "";
    }

    const first = result.candidates[0];
    elements.resultStatus.textContent = `已找到 ${result.candidates.length} 項結果：${formatCategorySummary(result)}。最近一項為 ${first.targetVolume} L，四捨五入後 ${formatMoney(first.roundedAmount)}。`;
  }

  function calculateAndRender({ announce = false } = {}) {
    if (!sharedState) return;
    const rawVolume = elements.stopVolume.value;

    if (elements.stopVolume.validity.badInput) {
      const message = "目前跳停公升數必須是有效數字。";
      setVolumeError(message);
      clearResults("請修正目前跳停公升數後再試算。");
      elements.resultStatus.textContent = `試算未更新：${message}`;
      return;
    }

    if (rawVolume.trim() === "") {
      const message = volumeTouched || announce ? "請輸入目前跳停公升數。" : "";
      setVolumeError(message);
      clearResults("請選擇油品與加油模式，並輸入目前跳停公升數；系統會分別尋找兩類各五項，合併後依增加公升數排序。");
      elements.resultStatus.textContent = announce
        ? "請先輸入目前跳停公升數。"
        : "尚未輸入目前跳停公升數。";
      return;
    }

    try {
      const result = roundingCalculator.findCandidates(getCurrentInput());
      setVolumeError("");

      if (result.candidates.length === 0) {
        clearResults("目前條件在 NT$20～NT$3,000 範圍內找不到小數部分介於 0.3（含）至 0.4（不含），或精確等於 0.4 的候選值。");
        elements.resultStatus.textContent = "目前金額範圍內找不到兩種指定小數條件的候選值。";
        return;
      }

      renderResults(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "目前跳停公升數無法進行試算。";
      setVolumeError(message);
      clearResults("請修正目前跳停公升數後再試算。");
      elements.resultStatus.textContent = `試算未更新：${message}`;
    }
  }

  async function loadSharedStateInternal() {
    const previousState = calculator.loadSharedFuelState(storage);
    const knownEffectiveDate = previousState?.priceMeta?.effectiveDate || "";

    try {
      const officialData = await globalThis.CpcRuntimePrices.load({ knownEffectiveDate, force: false });
      const defaultState = calculator.getDefaultState();
      sharedState = {
        prices: { ...officialData.prices },
        config: previousState?.config || defaultState.config,
        priceMeta: {
          effectiveDate: officialData.effectiveDate,
          retrievedAt: officialData.retrievedAt,
          source: officialData.source,
          sourceUrl: officialData.sourceUrl,
        },
      };
      calculator.savePreferences(storage, sharedState);
    } catch (_error) {
      sharedState = previousState;
    }

    const hasState = sharedState !== null;
    elements.app.hidden = !hasState;
    elements.missingState.hidden = hasState;

    if (!hasState) {
      elements.resultStatus.textContent = "尚未取得官方油價，請先回首頁確認同步狀態。";
      return;
    }

    updatePriceSummary();
    calculateAndRender({ announce: false });
  }

  async function loadSharedState() {
    if (stateLoadPromise) return stateLoadPromise;
    stateLoadPromise = loadSharedStateInternal();
    try {
      return await stateLoadPromise;
    } finally {
      stateLoadPromise = null;
    }
  }

  function applyTheme(theme) {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    elements.themeToggle.dataset.theme = theme;
    elements.themeToggle.querySelector(".theme-label").textContent =
      theme === "auto" ? "自動" : theme === "light" ? "淺色" : "深色";
    elements.themeToggle.querySelector(".theme-icon").textContent =
      theme === "auto" ? "◐" : theme === "light" ? "☀" : "☾";
    elements.themeToggle.setAttribute(
      "aria-label",
      `目前為${theme === "auto" ? "跟隨系統" : theme === "light" ? "淺色" : "深色"}模式，按下可切換`,
    );
  }

  function loadTheme() {
    let theme = "auto";
    try {
      const saved = storage && storage.getItem(calculator.THEME_STORAGE_KEY);
      if (["auto", "light", "dark"].includes(saved)) theme = saved;
    } catch (_error) {
      theme = "auto";
    }
    applyTheme(theme);
  }

  function cycleTheme() {
    const current = elements.themeToggle.dataset.theme || "auto";
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    applyTheme(next);
    try {
      if (storage) storage.setItem(calculator.THEME_STORAGE_KEY, next);
    } catch (_error) {
      // 儲存遭瀏覽器停用時，仍保留本次瀏覽的主題切換。
    }
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    volumeTouched = true;
    calculateAndRender({ announce: true });
  });

  elements.stopVolume.addEventListener("input", () => {
    volumeTouched = true;
    calculateAndRender({ announce: false });
  });

  elements.form.addEventListener("change", (event) => {
    if (event.target.matches('input[type="radio"]')) {
      updatePriceSummary();
      calculateAndRender({ announce: false });
    }
  });

  elements.themeToggle.addEventListener("click", cycleTheme);
  globalThis.addEventListener("pageshow", loadSharedState);
  globalThis.addEventListener("storage", (event) => {
    if (event.key === calculator.STORAGE_KEY || event.key === null) loadSharedState();
  });

  loadTheme();
  loadSharedState();
})();



/*
 * Node.js local server and synchronizer.
 * This block is inert in a browser.  It keeps local development, one-off
 * updates, and the GitHub Actions workflow in the same audited source file.
 */
const __cpcIsNodeRuntime =
  typeof process !== "undefined" &&
  !!process.versions &&
  !!process.versions.node &&
  typeof require === "function";

function __cpcNodeModules() {
  if (!__cpcIsNodeRuntime) {
    throw new Error("本功能需要 Node.js 20 或更新版本。");
  }

  return {
    fs: require("node:fs/promises"),
    http: require("node:http"),
    path: require("node:path"),
  };
}

function __cpcPriceApi() {
  const api = globalThis.CpcPriceData;
  if (!api) throw new Error("油價資料核心未載入。");
  return api;
}

async function readValidatedPriceSnapshot(dataFile) {
  const { fs } = __cpcNodeModules();
  try {
    const source = await fs.readFile(dataFile, "utf8");
    return __cpcPriceApi().validatePriceData(JSON.parse(source));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    return null;
  }
}

function comparablePriceSnapshot(data) {
  const { retrievedAt: _retrievedAt, ...stableData } = data;
  return JSON.stringify(stableData);
}

async function appendGithubOutput(name, value) {
  if (!__cpcIsNodeRuntime || !process.env.GITHUB_OUTPUT) return;
  const { fs } = __cpcNodeModules();
  await fs.appendFile(process.env.GITHUB_OUTPUT, name + "=" + value + "\n", "utf8");
}

async function fetchOfficialCpcPayload(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("目前 Node.js 不支援 fetch，請使用 Node.js 20 或更新版本。");
  }

  let response;
  try {
    response = await fetchImpl(__cpcPriceApi().OFFICIAL_SOURCE_URL, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(
      "連線台灣中油官方 JSON 失敗：" +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  if (!response || !response.ok) {
    throw new Error(
      "台灣中油官方 JSON 回應失敗（HTTP " +
        (response && response.status ? response.status : "未知") +
        "）。",
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      "台灣中油官方 JSON 無法解析：" +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function updatePriceFile(options = {}) {
  const { fs, path } = __cpcNodeModules();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const rootDir = options.rootDir || (typeof __dirname === "string" ? __dirname : process.cwd());
  const dataFile = options.dataFile || path.resolve(rootDir, "data/cpc-prices.json");
  const now = options.now || new Date();

  const rawPayload = await fetchOfficialCpcPayload(fetchImpl);
  const incoming = __cpcPriceApi().normalizeOfficialPayload(rawPayload, now);
  const existing = await readValidatedPriceSnapshot(dataFile);

  if (existing && existing.effectiveDate > incoming.effectiveDate) {
    throw new Error(
      "官方牌價生效日期倒退：現有 " +
        existing.effectiveDate +
        "，新資料 " +
        incoming.effectiveDate +
        "。為保留上一筆有效資料，本次更新已中止。",
    );
  }

  if (existing && comparablePriceSnapshot(existing) === comparablePriceSnapshot(incoming)) {
    await appendGithubOutput("changed", "false");
    return { changed: false, data: existing };
  }

  const serialized = JSON.stringify(incoming, null, 2) + "\n";
  const temporaryFile = dataFile + ".tmp";
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(temporaryFile, serialized, "utf8");
  await fs.rename(temporaryFile, dataFile);
  await appendGithubOutput("changed", "true");
  return { changed: true, data: incoming };
}

function localContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function sendLocalResponse(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}

async function createLocalServer(options = {}) {
  const { fs, http, path } = __cpcNodeModules();
  const rootDir = path.resolve(
    options.rootDir || (typeof __dirname === "string" ? __dirname : process.cwd()),
  );
  const host = options.host || "127.0.0.1";
  const requestedPort = Number.isInteger(options.port) ? options.port : 8080;
  const refreshTtlMs =
    Number.isFinite(options.refreshTtlMs) && options.refreshTtlMs >= 0
      ? options.refreshTtlMs
      : 5 * 60 * 1000;
  const backgroundIntervalMs =
    Number.isFinite(options.backgroundIntervalMs) && options.backgroundIntervalMs > 0
      ? options.backgroundIntervalMs
      : 6 * 60 * 60 * 1000;
  const dataFile = path.resolve(rootDir, "data/cpc-prices.json");
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const state = {
    lastCheckedAt: 0,
    refreshPromise: null,
    timer: null,
  };

  async function refreshSnapshot({ force = false } = {}) {
    const now = Date.now();
    if (!force && state.lastCheckedAt && now - state.lastCheckedAt < refreshTtlMs) {
      const cached = await readValidatedPriceSnapshot(dataFile);
      if (cached) {
        return {
          data: cached,
          changed: false,
          mode: "local",
          message: "使用五分鐘內已驗證的本機同步快取。",
        };
      }
    }

    if (state.refreshPromise) return state.refreshPromise;

    state.refreshPromise = (async () => {
      state.lastCheckedAt = Date.now();
      try {
        const result = await updatePriceFile({
          fetchImpl,
          dataFile,
          now: new Date(),
        });
        return {
          data: result.data,
          changed: result.changed,
          mode: "local",
          message: result.changed
            ? "已從台灣中油官方來源更新牌價。"
            : "官方牌價與目前快照一致。",
        };
      } catch (error) {
        const stale = await readValidatedPriceSnapshot(dataFile);
        if (stale) {
          return {
            data: stale,
            changed: false,
            mode: "stale",
            message:
              "官方來源暫時無法更新，已保留上一筆有效資料：" +
              (error instanceof Error ? error.message : String(error)),
          };
        }
        throw error;
      }
    })();

    try {
      return await state.refreshPromise;
    } finally {
      state.refreshPromise = null;
    }
  }

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url || "/",
      "http://" + (request.headers.host || host + ":" + requestedPort),
    );

    if (requestUrl.pathname === "/api/prices") {
      try {
        const result = await refreshSnapshot({
          force: requestUrl.searchParams.get("refresh") === "force",
        });
        const payload = {
          ...result.data,
          runtime: {
            mode: result.mode,
            message: result.message,
          },
        };
        sendLocalResponse(response, 200, JSON.stringify(payload), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } catch (error) {
        sendLocalResponse(
          response,
          503,
          JSON.stringify({
            error:
              "目前無法取得官方油價，也沒有可用的本機快照：" +
              (error instanceof Error ? error.message : String(error)),
          }),
          { "Content-Type": "application/json; charset=utf-8" },
        );
      }
      return;
    }

    const requestedPath =
      requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestedPath);
    } catch (_error) {
      sendLocalResponse(response, 400, "網址格式錯誤。", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    const filePath = path.resolve(rootDir, decodedPath);
    if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
      sendLocalResponse(response, 403, "禁止存取此路徑。", {
        "Content-Type": "text/plain; charset=utf-8",
      });
      return;
    }

    try {
      const body = await fs.readFile(filePath);
      sendLocalResponse(response, 200, body, {
        "Content-Type": localContentType(filePath),
      });
    } catch (error) {
      const status = error && error.code === "ENOENT" ? 404 : 500;
      sendLocalResponse(response, status, status === 404 ? "找不到檔案。" : "伺服器讀取失敗。", {
        "Content-Type": "text/plain; charset=utf-8",
      });
    }
  });

  await new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", rejectServer);
      resolveServer();
    });
  });

  // 啟動後立即檢查一次；失敗時仍可繼續提供上一份有效快照。
  refreshSnapshot({ force: true }).catch(() => {});

  state.timer = setInterval(() => {
    refreshSnapshot({ force: true }).catch(() => {});
  }, backgroundIntervalMs);
  if (typeof state.timer.unref === "function") state.timer.unref();

  return {
    server,
    host,
    port: server.address().port,
    rootDir,
    refresh: refreshSnapshot,
    async close() {
      if (state.timer) clearInterval(state.timer);
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}

function parseServePort(args) {
  const index = args.indexOf("--port");
  if (index === -1) return 8080;
  const port = Number(args[index + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError("--port 必須是介於 0 與 65535 的整數。");
  }
  return port;
}

async function runCpcCli() {
  if (!__cpcIsNodeRuntime) return;
  const command = process.argv[2];

  if (command === "update") {
    const result = await updatePriceFile();
    const prices = result.data.prices;
    console.log(
      result.changed
        ? "已更新 data/cpc-prices.json：牌價生效日 " +
            result.data.effectiveDate +
            "，98／95／92 = " +
            prices[98] +
            "／" +
            prices[95] +
            "／" +
            prices[92] +
            " 元／L。"
        : "官方油價與目前資料檔相同，未建立新資料或 commit。",
    );
    return;
  }

  if (command === "serve") {
    const instance = await createLocalServer({
      port: parseServePort(process.argv.slice(3)),
    });
    console.log("本機伺服器已啟動：http://" + instance.host + ":" + instance.port + "/");
    console.log("啟動時已檢查官方牌價；每次頁面開啟最多每五分鐘重新檢查一次。");
    return;
  }

  console.log("用法：node app.js serve [--port 8080]｜node app.js update");
}

if (__cpcIsNodeRuntime && typeof module !== "undefined" && require.main === module) {
  runCpcCli().catch((error) => {
    console.error("執行失敗：" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}

if (__cpcIsNodeRuntime && typeof module !== "undefined") {
  module.exports = Object.freeze({
    calculator: globalThis.CpcCalculator,
    priceData: globalThis.CpcPriceData,
    roundingCalculator: globalThis.CpcRoundingCalculator,
    runtimePrices: globalThis.CpcRuntimePrices,
    fetchOfficialCpcPayload,
    updatePriceFile,
    createLocalServer,
    runCpcCli,
  });
}
