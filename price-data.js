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
