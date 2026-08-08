(function initApp() {
  "use strict";

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

  async function loadOfficialPrices({ announce = true } = {}) {
    const previousState = calculator.loadPreferences(storage);
    const knownEffectiveDate = previousState?.priceMeta?.effectiveDate || "";
    elements.updatePriceButton.disabled = true;
    elements.updatePriceButton.setAttribute("aria-busy", "true");
    setPriceSyncStatus("正在讀取目前已發布的官方油價資料…", "loading");

    try {
      const data = await priceSource.loadPriceData({ knownEffectiveDate });
      const state = {
        prices: { ...data.prices },
        config: getConfigForSync(previousState),
        priceMeta: priceMetaFromData(data),
      };
      calculator.savePreferences(storage, state);
      populateForm(state);
      renderPriceCards(data);
      setPriceSyncStatus(`已同步台灣中油公告牌價，生效日 ${priceSource.formatEffectiveDate(data.effectiveDate)}。`, "success");
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
    loadOfficialPrices({ announce: true });
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
