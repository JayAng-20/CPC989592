(function initRoundingPage() {
  "use strict";

  const calculator = globalThis.CpcCalculator;
  const roundingCalculator = globalThis.CpcRoundingCalculator;
  if (!calculator || !roundingCalculator) {
    throw new Error("試算核心未載入，請確認頁面所需的 JavaScript 檔案位於同一資料夾。");
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
          <small>採用「加油回饋排名」頁面目前保存的牌價</small>
        `;
      } else {
        elements.priceSummary.innerHTML = `
          <span>${grade} 無鉛汽油</span>
          <strong>自助加油：${formatMoney(details.effective)}／L</strong>
          <small>原價 ${formatMoney(details.manual)}／L－自助優惠 ${formatMoney(details.discount)}／L＝自助價 ${formatMoney(details.effective)}／L</small>
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

  function loadSharedState() {
    sharedState = calculator.loadSharedFuelState(storage);
    const hasState = sharedState !== null;
    elements.app.hidden = !hasState;
    elements.missingState.hidden = hasState;

    if (!hasState) {
      elements.resultStatus.textContent = "尚未設定油價。";
      return;
    }

    updatePriceSummary();
    calculateAndRender({ announce: false });
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
