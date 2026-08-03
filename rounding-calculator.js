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
  const MIN_AMOUNT = 20n;
  const MAX_AMOUNT = 3000n;
  const DEFAULT_RESULT_LIMIT = 10;
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
    const qualifies = fractionUnits * 2n < denominator;
    const roundedAmount = (rawAmountUnits * 2n + denominator) / (2n * denominator);

    return {
      rawAmountUnits,
      rawAmountScale,
      denominator,
      fractionUnits,
      qualifies,
      roundedAmount,
      rawAmount: formatDecimal(
        { units: rawAmountUnits, scale: rawAmountScale },
        Math.max(3, rawAmountScale),
      ),
    };
  }

  function classifyUnroundedAmount(rawAmount) {
    const parsed = parseDecimal(rawAmount, {
      fieldName: "未進位金額",
      allowZero: true,
    });
    if (parsed.units < 0n) throw new RangeError("未進位金額不可為負數。");
    const denominator = powerOfTen(parsed.scale);
    const fractionUnits = parsed.units % denominator;
    return {
      qualifies: fractionUnits * 2n < denominator,
      roundedAmount: (parsed.units * 2n + denominator) / (2n * denominator),
    };
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
      const limit = input.limit === undefined ? DEFAULT_RESULT_LIMIT : Number(input.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_RESULT_LIMIT) {
        throw new RangeError(`結果數量必須是 1 至 ${DEFAULT_RESULT_LIMIT} 的整數。`);
      }
      return { valid: true, error: "", stopHundredths, unitPrices, limit };
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

    const { stopHundredths, unitPrices, limit } = validation;
    const unitPrice = unitPrices.effective;
    const denominator = powerOfTen(unitPrice.scale + 2);
    const minimumRawUnits = MIN_AMOUNT * denominator;
    const maximumRawUnits = MAX_AMOUNT * denominator;
    const stopRawUnits = unitPrice.units * stopHundredths;
    const requestedStart = stopHundredths + 1n;
    const firstInRange = ceilDivide(minimumRawUnits, unitPrice.units);
    const startHundredths = requestedStart > firstInRange ? requestedStart : firstInRange;
    const maximumHundredths = maximumRawUnits / unitPrice.units;
    const candidates = [];
    let searchedCount = 0;

    if (stopRawUnits <= maximumRawUnits && startHundredths <= maximumHundredths) {
      let target = startHundredths;
      while (target <= maximumHundredths && candidates.length < limit) {
        searchedCount += 1;
        const amount = analyzeAmount(unitPrice, target);
        if (amount.qualifies) {
          const additionalHundredths = target - stopHundredths;
          candidates.push({
            rank: candidates.length + 1,
            targetVolume: formatVolume(target),
            additionalVolume: formatVolume(additionalHundredths),
            additionalMilliliters: (additionalHundredths * 10n).toString(),
            rawAmount: amount.rawAmount,
            roundedAmount: amount.roundedAmount.toString(),
          });
          target += 1n;
          continue;
        }

        // The remainder can only increase until the next whole-dollar boundary.
        // Jumping straight there is equivalent to testing every 0.01 L value, while
        // still guaranteeing progress for extremely small effective unit prices.
        const wholeAmount = amount.rawAmountUnits / amount.denominator;
        const nextWholeRawUnits = (wholeAmount + 1n) * amount.denominator;
        const nextTarget = ceilDivide(nextWholeRawUnits, unitPrice.units);
        target = nextTarget > target ? nextTarget : target + 1n;
      }
    }

    const resultLimitReached = candidates.length === limit;
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
      candidates,
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
    MIN_AMOUNT,
    MAX_AMOUNT,
    DEFAULT_RESULT_LIMIT,
    parseDecimal,
    parseStopVolume,
    resolveEffectiveUnitPrice,
    analyzeAmount,
    classifyUnroundedAmount,
    validateSearchInput,
    findCandidates,
  });
});
