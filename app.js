/* global CostCalc */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var clamp = function (n, min, max) { return Math.min(max, Math.max(min, n)); };
  var clone = CostCalc.clone;
  var DEFAULT_STATE = CostCalc.DEFAULT_STATE;

  var LS_DRAFT = "costcalc.mobile.draft.v1";
  var LS_HISTORY = "costcalc.mobile.history.v1";
  var LS_THEME = "costcalc.mobile.theme.v1";
  var MAX_HISTORY = 60;
  var VIEWS = ["calculator", "compare", "sensitivity", "history"];

  var moneyFormatter = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  var integerFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = loadDraft();
  var savedRecords = loadHistory();
  var currentView = "calculator";
  var historyQuery = "";
  var deferredPrompt = null;
  var saveTimer = null;
  var lastNet = null;

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function loadDraft() {
    try {
      var raw = readStorage(LS_DRAFT);
      if (!raw) return clone(DEFAULT_STATE);
      return CostCalc.sanitizeState(JSON.parse(raw));
    } catch (e) {
      return clone(DEFAULT_STATE);
    }
  }

  function loadHistory() {
    try {
      var raw = readStorage(LS_HISTORY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map(normalizeRecord).filter(Boolean).slice(0, MAX_HISTORY);
    } catch (e) {
      return [];
    }
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== "object" || !record.state) return null;
    var recordState = CostCalc.sanitizeState(record.state);
    var result = CostCalc.compute(recordState);
    return {
      id: String(record.id || (Date.now() + "-" + Math.random().toString(36).slice(2, 7))),
      name: String(record.name || "未命名记录").slice(0, 60),
      timestamp: record.timestamp || new Date().toISOString(),
      state: recordState,
      summary: {
        net: result.net,
        perDeal: result.perDeal,
        perOrder: result.perOrder,
        returnRate: result.returnRate,
        refundRate: result.refundRateActual,
        completed: result.completed,
        totalFees: result.totalFees,
        scenario: result.mode
      }
    };
  }

  function persistHistory() {
    savedRecords = savedRecords.slice(0, MAX_HISTORY);
    writeStorage(LS_HISTORY, JSON.stringify(savedRecords));
    renderHistory();
  }

  function persistDraft() {
    var ok = writeStorage(LS_DRAFT, JSON.stringify(state));
    var el = $("#autosaveStatus");
    if (el) el.textContent = ok ? "已自动保存 " + timeShort(new Date()) : "当前仅本次有效";
  }

  function scheduleSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    var el = $("#autosaveStatus");
    if (el) el.textContent = "保存中…";
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      persistDraft();
    }, 260);
  }

  function applyTheme(theme) {
    var next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    writeStorage(LS_THEME, next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#07131b" : "#f3f6f8");
    var btn = $("#themeBtn");
    if (btn) btn.setAttribute("aria-label", next === "dark" ? "切换浅色模式" : "切换深色模式");
  }

  function initialTheme() {
    var stored = readStorage(LS_THEME);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function timeShort(date) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function dateTime(iso) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      }).format(new Date(iso));
    } catch (e) {
      return iso;
    }
  }

  function money(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return moneyFormatter.format(n);
  }

  function moneyShort(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return (n < 0 ? "−¥" : "¥") + integerFormatter.format(Math.abs(Math.round(n)));
  }

  function negMoney(value) {
    return "−" + money(Math.abs(Number(value) || 0));
  }

  function signedMoney(value) {
    var n = Number(value) || 0;
    return n > 0 ? "+" + money(n) : n < 0 ? negMoney(n) : money(0);
  }

  function pct(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return (n * 100).toFixed(2) + "%";
  }

  function count(value) {
    return integerFormatter.format(Math.max(0, Math.round(Number(value) || 0)));
  }

  function inputNumber(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "";
    return String(Math.round(n * 10000) / 10000);
  }

  function inputPercent(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function renderCostRows() {
    var wrap = $("#costRows");
    var countEl = $("#costCount");
    if (countEl) countEl.textContent = state.items.length + " 项";
    if (!wrap) return;
    if (!state.items.length) {
      wrap.innerHTML = '<div class="row-empty">还没有配件，点右上角「添加配件」。</div>';
      return;
    }
    wrap.innerHTML = state.items.map(function (item) {
      var id = escapeHtml(item.id);
      return (
        '<div class="cost-row" data-item-row="' + id + '">' +
          '<div class="cost-name">' +
            '<input class="name-input" data-item-id="' + id + '" data-prop="name" data-field="items.' + id + '.name" value="' + escapeHtml(item.name) + '" maxlength="30" title="点这里改配件名称" aria-label="配件名称">' +
            '<span class="cost-meta"><small>' + escapeHtml(item.note || "自定义配件") + '</small><span class="cost-share" data-share-id="' + id + '">占比 0.0%</span></span>' +
          '</div>' +
          '<span class="input-shell"><span class="affix">¥</span><input type="number" inputmode="decimal" min="0" step="0.01" data-item-id="' + id + '" data-prop="current" data-field="items.' + id + '.current" value="' + inputNumber(item.current) + '" aria-label="' + escapeHtml(item.name) + '当前价"></span>' +
          '<span class="input-shell replacement"><span class="affix">¥</span><input type="number" inputmode="decimal" min="0" step="0.01" data-item-id="' + id + '" data-prop="replacement" data-field="items.' + id + '.replacement" value="' + (item.replacement === "" ? "" : inputNumber(item.replacement)) + '" placeholder="—" title="留空 = 沿用当前价" aria-label="' + escapeHtml(item.name) + '替换价"></span>' +
          '<button class="row-delete" type="button" data-remove-item="' + id + '" aria-label="删除' + escapeHtml(item.name) + '" title="删除这个配件">×</button>' +
        '</div>'
      );
    }).join("");
  }

  function renderFeeRows() {
    var wrap = $("#feeRows");
    var countEl = $("#feeCount");
    if (countEl) countEl.textContent = state.feeItems.length + " 项";
    if (!wrap) return;
    if (!state.feeItems.length) {
      wrap.innerHTML = '<div class="row-empty">还没有费用，点右上角「添加费用」。</div>';
      return;
    }
    wrap.innerHTML = state.feeItems.map(function (fee) {
      var id = escapeHtml(fee.id);
      return (
        '<div class="fee-row" data-fee-row="' + id + '">' +
          '<div class="fee-main">' +
            '<input class="name-input" data-fee-id="' + id + '" data-prop="name" data-field="feeItems.' + id + '.name" value="' + escapeHtml(fee.name) + '" maxlength="30" title="点这里改费用名称" aria-label="费用名称">' +
            '<small>' + escapeHtml(fee.note || "自定义费用") + '</small>' +
            '<span class="fee-calc"><span data-fee-base="' + id + '">按成交单 0 单</span> · <b data-fee-total="' + id + '">¥0.00</b></span>' +
          '</div>' +
          '<select class="basis-select" data-fee-id="' + id + '" data-prop="basis" data-field="feeItems.' + id + '.basis" aria-label="计费基数">' +
            '<option value="deal"' + (fee.basis === "deal" ? " selected" : "") + '>成交单</option>' +
            '<option value="return"' + (fee.basis === "return" ? " selected" : "") + '>退货单</option>' +
          '</select>' +
          '<span class="input-shell"><span class="affix">¥</span><input type="number" inputmode="decimal" min="0" step="0.001" data-fee-id="' + id + '" data-prop="value" data-field="feeItems.' + id + '.value" value="' + inputNumber(fee.value) + '" aria-label="' + escapeHtml(fee.name) + '单均金额"></span>' +
          '<button class="row-delete" type="button" data-remove-fee="' + id + '" aria-label="删除' + escapeHtml(fee.name) + '" title="删除这个费用">×</button>' +
        '</div>'
      );
    }).join("");
  }

  function syncInputs() {
    var price = $("#price");
    var orders = $("#orders");
    if (price) price.value = inputNumber(state.price);
    if (orders) orders.value = String(Math.round(Number(state.orders) || 0));
    if ($("#returnRate")) $("#returnRate").value = inputPercent(state.returnRate);
    if ($("#refundRate")) $("#refundRate").value = inputPercent(state.refundRate);
    if ($("#shipping")) $("#shipping").value = inputNumber(state.shipping);
    if ($("#refundOverride")) $("#refundOverride").value = state.refundOverride === "" ? "" : String(state.refundOverride);

    renderCostRows();
    renderFeeRows();
    setRangeValue($("#returnRange"), state.returnRate);
    setRangeValue($("#refundRange"), state.refundRate);
    updateScenarioUI();
  }

  function updateRowMath(result) {
    $$("#costRows [data-share-id]").forEach(function (el) {
      var id = el.getAttribute("data-share-id");
      var item = state.items.filter(function (entry) { return entry.id === id; })[0];
      if (!item) return;
      var value = state.scenario === "replacement" && item.replacement !== "" ? Number(item.replacement) : Number(item.current);
      var share = result.goodsCost > 0 ? value / result.goodsCost : 0;
      el.textContent = "占比 " + pct(share);
    });
    $$("#feeRows [data-fee-base]").forEach(function (el) {
      var id = el.getAttribute("data-fee-base");
      var fee = state.feeItems.filter(function (entry) { return entry.id === id; })[0];
      if (!fee) return;
      var base = fee.basis === "return" ? result.returns : result.completed;
      var totalEl = document.querySelector('[data-fee-total="' + id + '"]');
      el.textContent = "按" + (fee.basis === "return" ? "退货单" : "成交单") + " " + count(base) + " 单";
      if (totalEl) totalEl.textContent = money(Number(fee.value) * base);
    });
  }

  function setRangeValue(range, value) {
    if (!range) return;
    var v = clamp(Number(value) || 0, 0, 100);
    range.value = v;
    var progress = clamp(v, 0, 100) + "%";
    range.style.setProperty("--range-progress", progress);
  }

  function updateScenarioUI() {
    $$("#scenarioSwitch [data-scenario]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.scenario === state.scenario);
    });
    var chip = $("#scenarioToggle");
    if (chip) chip.textContent = state.scenario === "replacement" ? "替换价 ⇄" : "当前价 ⇄";
    var mobile = $("#mobileScenarioToggle");
    if (mobile) mobile.textContent = state.scenario === "replacement" ? "替换价" : "当前价";
  }

  function toggleScenario() {
    state.scenario = state.scenario === "replacement" ? "current" : "replacement";
    updateAll();
    scheduleSave();
  }

  function updateRefundUI(result) {
    var manual = state.refundOverride !== "" && Number.isFinite(Number(state.refundOverride));
    var tag = $("#refundMode");
    var rateInput = $("#refundRate");
    var range = $("#refundRange");
    var actualRate = result.returns > 0 ? result.refunds / result.returns * 100 : 0;

    if (tag) {
      tag.textContent = manual ? "手动实际" : "自动";
      tag.classList.toggle("is-manual", manual);
    }
    if (rateInput) {
      rateInput.classList.toggle("is-linked", manual);
      if (manual) {
        rateInput.value = actualRate.toFixed(2);
      } else if (document.activeElement !== rateInput) {
        rateInput.value = inputPercent(state.refundRate);
      }
    }
    if (range) {
      range.classList.toggle("is-linked", manual);
      setRangeValue(range, manual ? actualRate : state.refundRate);
    }

    var hint = $("#refundHint");
    if (hint) {
      if (manual && Number(state.refundOverride) > result.returns) {
        hint.textContent = "实际数不能大于退货数，当前按退货数上限计算；上方百分比显示为 100%。";
      } else if (manual) {
        hint.textContent = "上方百分比已联动为实际 " + actualRate.toFixed(2) + "%；直接改百分比或拖动滑杆会恢复自动计算。";
      } else {
        hint.textContent = "自动算出 " + count(result.refunds) + " 个；实际差一个时，填实际数量，上方百分比会自动联动。";
      }
    }
  }

  function validateInputs() {
    var errors = [];
    var price = Number(state.price);
    var orders = Number(state.orders);
    var returnRate = Number(state.returnRate);
    var refundRate = Number(state.refundRate);
    var result = CostCalc.compute(state);

    if (!Number.isFinite(price) || price <= 0) errors.push({ key: "price", message: "售价必须大于 0" });
    if (!Number.isFinite(orders) || orders <= 0) errors.push({ key: "orders", message: "订单数必须大于 0" });
    else if (!Number.isInteger(orders)) errors.push({ key: "orders", message: "订单数需要是整数" });
    if (!Number.isFinite(returnRate) || returnRate < 0 || returnRate > 100) errors.push({ key: "returnRate", message: "退货率应在 0%–100%" });
    if (!Number.isFinite(refundRate) || refundRate < 0 || refundRate > 100) errors.push({ key: "refundRate", message: "仅退款率应在 0%–100%" });

    if (state.refundOverride !== "" && Number.isFinite(Number(state.refundOverride))) {
      if (Number(state.refundOverride) < 0) errors.push({ key: "refundOverride", message: "仅退款实际数不能为负" });
      else if (Number(state.refundOverride) > result.returns) errors.push({ key: "refundOverride", message: "仅退款实际数不能大于退货数" });
    }

    state.items.forEach(function (item) {
      if (Number(item.current) < 0) errors.push({ key: "items." + item.id + ".current", message: item.name + "成本不能为负" });
    });
    state.feeItems.forEach(function (fee) {
      if (Number(fee.value) < 0) errors.push({ key: "feeItems." + fee.id + ".value", message: fee.name + "费用不能为负" });
    });
    if (Number(state.shipping) < 0) errors.push({ key: "shipping", message: "快递费不能为负" });

    return errors;
  }

  function renderWarning(errors) {
    var warning = $("#formWarning");
    $$(".input-shell.is-invalid").forEach(function (el) { el.classList.remove("is-invalid"); });
    if (warning) {
      if (!errors.length) {
        warning.hidden = true;
        warning.innerHTML = "";
      } else {
        warning.hidden = false;
        warning.innerHTML = "请检查：" + errors.slice(0, 3).map(function (e) { return e.message; }).join("；") + (errors.length > 3 ? " 等" : "");
      }
    }
    errors.forEach(function (e) {
      var field = document.querySelector('[data-field="' + e.key + '"]');
      var shell = field && field.closest(".input-shell");
      if (shell) shell.classList.add("is-invalid");
    });
  }

  function setBind(name, value, formatter, animate) {
    var els = $$('[data-bind="' + name + '"]');
    els.forEach(function (el) {
      var target = Number(value);
      var previous = Number(el.dataset.numeric);
      var textValue = formatter(value);
      if (animate && !reduceMotion && Number.isFinite(target) && Number.isFinite(previous) && Math.abs(target - previous) > 0.0001) {
        animateNumber(el, target, formatter);
      } else {
        el.textContent = textValue;
        el.dataset.numeric = Number.isFinite(target) ? target : "";
      }
    });
  }

  function animateNumber(el, target, formatter) {
    var from = Number(el.dataset.numeric) || 0;
    var start = performance.now();
    var duration = 340;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (el._fallback) window.clearTimeout(el._fallback);
    function settle() {
      if (el._raf) {
        cancelAnimationFrame(el._raf);
        el._raf = null;
      }
      el.dataset.numeric = target;
      el.textContent = formatter(target);
      el._fallback = null;
    }
    function frame(now) {
      if (document.hidden) {
        settle();
        return;
      }
      var p = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      var value = from + (target - from) * eased;
      el.textContent = formatter(value);
      if (p < 1) {
        el._raf = requestAnimationFrame(frame);
      } else {
        settle();
      }
    }
    el._raf = requestAnimationFrame(frame);
    // 后台标签页、无头浏览器或 RAF 被暂停时，也保证最终数值落地。
    el._fallback = window.setTimeout(settle, duration + 90);
  }

  function updateAll() {
    var result = CostCalc.compute(state);
    var comparison = CostCalc.compare(state);
    var errors = validateInputs();

    renderWarning(errors);

    setBind("net", result.net, money, true);
    setBind("netMargin", result.netMargin, pct);
    setBind("perDeal", result.perDeal, money, true);
    setBind("perOrder", result.perOrder, money);
    setBind("breakEven", result.breakEven, money);
    setBind("returns", result.returns, count);
    setBind("refunds", result.refunds, count);
    setBind("completed", result.completed, count);
    setBind("refundOrderShare", result.orders > 0 ? result.refunds / result.orders : 0, pct);
    setBind("unitCost", result.unitCost, money);
    setBind("goodsCost", result.goodsCost, money);
    setBind("currentUnitCost", comparison.current.unitCost, money);
    setBind("replacementUnitCost", comparison.replacement.unitCost, money);
    setBind("unitCostDiff", comparison.replacement.unitCost - comparison.current.unitCost, signedMoney);
    setBind("totalFees", result.totalFees, money);
    setBind("feeBaseTotal", result.feeBaseTotal, money);
    setBind("dealFees", result.dealFees, money);
    setBind("returnRefundFees", result.returnRefundFees, money);
    setBind("refundLoss", result.refundLoss, money);
    setBind("revenue", result.revenue, money);
    setBind("cogsNeg", result.cogs, negMoney);
    setBind("dealFeesNeg", result.dealFees, negMoney);
    setBind("returnRefundFeesNeg", result.returnRefundFees, negMoney);
    setBind("totalCost", result.totalCost, money);
    setBind("costMargin", result.costMargin, pct);
    setBind("scenarioLabel", result.mode === "replacement" ? "替换价" : "当前价", function (v) { return v; });
    if ($("#costCount")) $("#costCount").textContent = state.items.length + " 项 · 单件 " + money(result.unitCost);
    if ($("#feeCount")) $("#feeCount").textContent = state.feeItems.length + " 项 · 合计 " + money(result.totalFees);

    updateRowMath(result);
    updateRefundUI(result);
    updateScenarioUI();
    renderAllocation(result);
    renderInsights(result, comparison);
    renderCompare(comparison);
    renderSensitivity();
    renderTarget(result);
    updateStickyVisibility();

    if (lastNet !== null && Math.abs(result.net - lastNet) > 0.005) {
      $$(".hero-value, .mobile-profit").forEach(function (el) {
        el.classList.remove("is-bumping");
        void el.offsetWidth;
        el.classList.add("is-bumping");
      });
    }
    lastNet = result.net;
  }

  function renderAllocation(result) {
    var bar = $("#allocationBar");
    var legend = $("#allocationLegend");
    if (!bar || !legend) return;
    var total = result.cogs + result.dealFees + result.returnRefundFees + Math.max(result.net, 0);
    if (!(total > 0)) total = 1;
    var parts = [
      { key: "cogs", label: "货品成本", value: result.cogs, color: "#7d93a3", cls: "seg-cogs" },
      { key: "deal", label: "成交单费用", value: result.dealFees, color: "#d8a34b", cls: "seg-deal" },
      { key: "refund", label: "退货及退款", value: result.returnRefundFees, color: "#c76b5a", cls: "seg-refund" },
      { key: "profit", label: "净利润", value: Math.max(result.net, 0), color: "#2f8f72", cls: "seg-profit" }
    ];
    bar.innerHTML = parts.map(function (p) {
      return '<span class="' + p.cls + '" style="width:' + (p.value / total * 100).toFixed(3) + '%"></span>';
    }).join("");
    legend.innerHTML = parts.map(function (p) {
      var share = result.revenue > 0 ? p.value / result.revenue : 0;
      return '<span class="legend-item"><i class="legend-dot" style="background:' + p.color + '"></i>' + p.label + ' <b>' + pct(share) + '</b></span>';
    }).join("");
  }

  function renderInsights(result, comparison) {
    var wrap = $("#insightList");
    if (!wrap) return;
    var perReturn = result.returns > 0 ? result.returnRefundFees / result.returns : 0;
    var perPp = result.orders * ((result.price - result.unitCost - result.dealFeeUnit) + perReturn) / 100;
    var deltaText;
    if (comparison.deltaNet >= 0) {
      deltaText = "替换箱子/外壳，净利润约增加 <b>" + money(comparison.deltaNet) + "</b>。";
    } else {
      deltaText = "替换后净利润减少 <b>" + money(Math.abs(comparison.deltaNet)) + "</b>，请检查替换价。";
    }
    var items = [
      "每成交单净赚 <b>" + money(result.perDeal) + "</b>，净利率 <b>" + pct(result.netMargin) + "</b>。",
      "退货率每 +1 个百分点，净利润约减少 <b>" + money(Math.abs(perPp)) + "</b>。",
      deltaText,
      "可承受每下单广告费约 <b>" + money(result.perOrder) + "</b>；保本售价 <b>" + money(result.breakEven) + "</b>。"
    ];
    wrap.innerHTML = items.map(function (text) {
      return '<div class="insight-item"><i class="insight-bullet"></i><span>' + text + "</span></div>";
    }).join("");
  }

  function renderCompare(comparison) {
    var cards = $("#compareCards");
    var table = $("#compareTable");
    var volume = $("#volumeTable");
    var context = $("#compareContext");
    var reasons = $("#compareReasons");
    if (!cards || !table || !volume) return;
    var current = comparison.current;
    var replacement = comparison.replacement;
    var currentActive = state.scenario !== "replacement";
    var replacementActive = state.scenario === "replacement";
    var hasReplacement = state.items.some(function (item) { return item.replacement !== ""; });

    if (context) {
      context.innerHTML =
        '<span class="soft-tag">计算器当前采用：<b>' + (replacementActive ? "替换价" : "当前价") + '</b></span>' +
        '<span class="soft-tag">订单 ' + count(current.orders) + ' · 退货率 ' + pct(current.returnRate / 100) + ' · 仅退款 ' + count(current.refunds) + ' 个</span>' +
        (hasReplacement ? "" : '<span class="soft-tag is-warn">还没有填替换价，两套结果会一样</span>');
    }

    function card(kind, title, result, active) {
      return '<article class="compare-card is-' + kind + (active ? " is-in-use" : "") + '">' +
        '<div class="compare-card-head"><span class="eyebrow">' + title + '</span>' + (active ? '<span class="soft-tag is-active">正在使用</span>' : "") + '</div>' +
        '<strong>' + money(result.net) + '</strong><p>净利润</p>' +
        '<div class="mini-metrics"><span>成交单均净利 <b>' + money(result.perDeal) + '</b></span><span>保本售价 <b>' + money(result.breakEven) + '</b></span></div>' +
        '<button class="compare-apply" type="button" data-compare-scenario="' + kind + '"' + (active ? " disabled" : "") + '>' + (active ? "当前正在使用" : "切换到" + (kind === "replacement" ? "替换价" : "当前价")) + '</button>' +
      '</article>';
    }

    cards.innerHTML =
      card("current", "当前采购价", current, currentActive) +
      card("replacement", "替换后采购价", replacement, replacementActive) +
      '<article class="compare-card is-delta"><span class="eyebrow">净利润差额</span><strong class="' + (comparison.deltaNet >= 0 ? "positive" : "negative") + '">' + signedMoney(comparison.deltaNet) + '</strong><p>同一批订单下替换后的净利润变化</p><div class="mini-metrics"><span>成交单均变化 <b>' + signedMoney(comparison.deltaPerDeal) + '</b></span><span>保本价变化 <b>' + signedMoney(comparison.deltaBreakEven) + '</b></span></div></article>';

    if (reasons) {
      var goodsDelta = replacement.goodsCost - current.goodsCost;
      var goodsProfit = -current.completed * goodsDelta;
      var refundDelta = replacement.refundLoss - current.refundLoss;
      var refundProfit = -refundDelta;
      var feeDelta = (replacement.dealFees + replacement.returnBaseFees) - (current.dealFees + current.returnBaseFees);
      var feeProfit = -feeDelta;
      reasons.innerHTML =
        '<div class="reason-card"><span>货品成本变化</span><strong class="' + (goodsProfit >= 0 ? "positive" : "negative") + '">' + signedMoney(goodsProfit) + '</strong><small>单件成本 ' + signedMoney(goodsDelta) + ' × ' + count(current.completed) + ' 单</small></div>' +
        '<div class="reason-card"><span>仅退款损失变化</span><strong class="' + (refundProfit >= 0 ? "positive" : "negative") + '">' + signedMoney(refundProfit) + '</strong><small>损失 ' + signedMoney(refundDelta) + '</small></div>' +
        '<div class="reason-card"><span>其他费用变化</span><strong class="' + (feeProfit >= 0 ? "positive" : "negative") + '">' + signedMoney(feeProfit) + '</strong><small>成交单 / 退货费用差额</small></div>' +
        '<div class="reason-card is-total"><span>净利润合计变化</span><strong class="' + (comparison.deltaNet >= 0 ? "positive" : "negative") + '">' + signedMoney(comparison.deltaNet) + '</strong><small>三项相加</small></div>';
    }

    var rows = [
      ["单件货品成本", current.goodsCost, replacement.goodsCost, "money", "down"],
      ["单件总成本", current.unitCost, replacement.unitCost, "money", "down"],
      ["整批总成本", current.totalCost, replacement.totalCost, "money", "down"],
      ["成交单费用", current.dealFees, replacement.dealFees, "money", "down"],
      ["退货及退款费用", current.returnRefundFees, replacement.returnRefundFees, "money", "down"],
      ["其中：仅退款净损失", current.refundLoss, replacement.refundLoss, "money", "down"],
      ["净利润", current.net, replacement.net, "money", "up"],
      ["净利率", current.netMargin, replacement.netMargin, "pct", "up"],
      ["单均净利（成交单）", current.perDeal, replacement.perDeal, "money", "up"],
      ["含退货下单均摊", current.perOrder, replacement.perOrder, "money", "up"],
      ["保本售价", current.breakEven, replacement.breakEven, "money", "down"]
    ];
    table.innerHTML =
      '<thead><tr><th>指标</th><th>当前价</th><th>替换价</th><th>差额</th></tr></thead><tbody>' +
      rows.map(function (row) {
        var fmt = row[3] === "pct" ? pct : money;
        var diff = row[2] - row[1];
        var diffText = row[3] === "pct" ? (diff >= 0 ? "+" : "") + (diff * 100).toFixed(2) + "pp" : signedMoney(diff);
        var favorable = row[4] === "down" ? diff < 0 : diff > 0;
        var cls = Math.abs(diff) < 0.000001 ? "" : favorable ? "positive" : "negative";
        return '<tr' + (row[0] === "净利润" ? ' class="is-emphasis"' : "") + '><td>' + row[0] + '</td><td>' + fmt(row[1]) + '</td><td>' + fmt(row[2]) + '</td><td class="' + cls + '">' + diffText + '</td></tr>';
      }).join("") + "</tbody>";

    var ordersList = uniqueSorted([500, 800, 1000, 1140, 1500, 2000, 3000, state.orders]);
    volume.innerHTML =
      '<thead><tr><th>订单数</th><th>当前方案</th><th>替换方案</th><th>替换增益</th></tr></thead><tbody>' +
      ordersList.map(function (orders) {
        var a = CostCalc.compute(state, { mode: "current", orders: orders, refundOverride: "" });
        var b = CostCalc.compute(state, { mode: "replacement", orders: orders, refundOverride: "" });
        var diff = b.net - a.net;
        var isCurrent = Math.abs(Number(state.orders) - orders) < 0.5;
        return '<tr' + (isCurrent ? ' class="is-emphasis"' : "") + '><td>' + count(orders) + '</td><td>' + money(a.net) + '</td><td>' + money(b.net) + '</td><td class="' + (diff >= 0 ? "positive" : "negative") + '">' + signedMoney(diff) + '</td></tr>';
      }).join("") + "</tbody>";
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.map(function (v) { return Math.round(Number(v) * 100) / 100; }).filter(Number.isFinite))).sort(function (a, b) { return a - b; });
  }

  function renderSensitivity() {
    var table = $("#heatmap");
    var meta = $("#sensMeta");
    var guide = $("#sensGuide");
    if (!table || !meta) return;
    var currentResult = CostCalc.compute(state);
    var sens = CostCalc.sensitivity(state, { mode: state.scenario });
    var currentRate = Math.round(Number(state.returnRate) * 100) / 100;
    var modeLabel = state.scenario === "replacement" ? "替换价" : "当前价";
    meta.innerHTML =
      '<span class="meta-pill">当前方案 <b>' + modeLabel + '</b></span>' +
      '<span class="meta-pill">当前净利润 <b>' + money(currentResult.net) + '</b></span>' +
      '<span class="meta-pill">退货率 <b>' + pct(Number(state.returnRate) / 100) + '</b></span>' +
      '<span class="meta-pill">仅退款率 <b>' + pct(currentResult.refundRateActual / 100) + '</b></span>' +
      '<span class="meta-pill">点击格子 <b>应用到计算器</b></span>';
    if (guide) {
      guide.innerHTML =
        '<div class="sens-guide-text"><b>怎么看：</b>表格里的数字都是净利润（元）；绿色越深利润越高，红色表示亏损。当前高亮格是 ' + count(currentResult.orders) + ' 单 / ' + pct(currentResult.returnRate / 100) + ' 退货率。</div>' +
        '<div class="heat-legend"><span>低</span><i></i><span>高</span><em>红色 = 亏损</em></div>' +
        '<div class="sens-guide-foot">净利润范围 <b>' + money(sens.min) + ' ~ ' + money(sens.max) + '</b> · 表格按“仅退款率 ' + pct(currentResult.refundRateActual / 100) + '”计算，点击格子只改订单数和退货率。</div>' +
        '<div class="sens-scroll-hint">左右滑动表格查看更多订单量 →</div>';
    }

    table.innerHTML =
      '<thead><tr><th>退货率＼订单</th>' + sens.ordersList.map(function (o) { return "<th>" + count(o) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      sens.rows.map(function (row) {
        return "<tr><th>" + pct(row.rate / 100) + "</th>" + row.cols.map(function (cell) {
          var isCurrent = Math.abs(cell.orders - Number(state.orders)) < 0.5 && Math.abs(cell.returnRate - currentRate) < 0.01;
          var bg = heatColor(cell.net, sens.min, sens.max);
          return '<td class="' + (cell.net < 0 ? "is-negative " : "") + (isCurrent ? "is-current" : "") + '" style="background:' + bg + '" data-orders="' + cell.orders + '" data-rate="' + cell.returnRate + '" title="点击应用：' + count(cell.orders) + ' 单 / ' + pct(cell.returnRate / 100) + '">' + moneyShort(cell.net) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody>";

    var wrap = table.parentElement;
    var currentCell = table.querySelector("td.is-current");
    if (wrap && currentCell && wrap.clientWidth > 0 && wrap.scrollWidth > wrap.clientWidth + 2) {
      var rowHead = table.querySelector("thead th");
      var stickyWidth = rowHead ? rowHead.getBoundingClientRect().width : 80;
      var wrapRect = wrap.getBoundingClientRect();
      var cellRect = currentCell.getBoundingClientRect();
      if (cellRect.left < wrapRect.left + stickyWidth - 1 || cellRect.right > wrapRect.right + 1) {
        wrap.scrollLeft = Math.max(0, currentCell.offsetLeft - stickyWidth);
      }
    }
  }

  function heatColor(value, min, max) {
    var t = max === min ? 0.5 : (value - min) / (max - min);
    t = clamp(t, 0, 1);
    if (value < 0) return "rgba(185,74,59," + (0.10 + 0.23 * t).toFixed(3) + ")";
    return "rgba(15,118,110," + (0.05 + 0.25 * t).toFixed(3) + ")";
  }

  function renderTarget(result) {
    var input = $("#targetProfit");
    if (!input) return;
    var target = Math.max(0, Number(input.value) || 0);
    var reverse = CostCalc.reverseTarget(state, target);
    $("#targetDeals").textContent = reverse.deals === null ? "—" : count(reverse.deals);
    $("#targetOrders").textContent = reverse.orders === null ? "—" : count(reverse.orders);
    $("#targetDeals").title = "按当前成交单净利 " + money(reverse.perDeal);
    $("#targetOrders").title = "按当前含退货下单均摊 " + money(reverse.perOrder);
    var note = $("#targetNote");
    if (note) {
      if (reverse.perDeal <= 0) {
        note.textContent = "当前成交单均净利为负，无法用利润目标反推订单量；先调整售价或成本。";
      } else {
        note.innerHTML = "当前成交单均净利 <b>" + money(reverse.perDeal) + "</b> · 当前含退货下单均摊 <b>" + money(reverse.perOrder) + "</b>。目标净利润 " + money(target) + " ÷ 成交单均净利，得到需要成交单；再按当前退货率折算订单。";
      }
    }
  }

  function updateStickyVisibility() {
    var sticky = $("#stickyResult");
    var summary = $(".mobile-summary");
    if (!sticky) return;
    var show = currentView === "calculator" && window.innerWidth <= 980 && summary && summary.getBoundingClientRect().bottom < 0;
    sticky.classList.toggle("is-visible", Boolean(show));
  }

  function navigate(view, push) {
    if (VIEWS.indexOf(view) === -1) view = "calculator";
    currentView = view;
    $$(".view").forEach(function (section) {
      section.classList.toggle("is-active", section.id === "view-" + view);
    });
    $$(".nav-tab, .mobile-nav-item").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
    document.body.dataset.currentView = view;
    if (push !== false && location.hash !== "#" + view) {
      window.history.pushState({ view: view }, "", "#" + view);
    }
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    closeMenu();
    updateStickyVisibility();
    if (view === "history") renderHistory();
    if (view === "sensitivity") renderSensitivity();
  }

  function renderHistory() {
    var list = $("#historyList");
    var countEl = $("#historyCount");
    var clearBtn = $("#historySearchClear");
    if (!list) return;
    var query = historyQuery.trim().toLowerCase();
    var records = savedRecords.filter(function (record) {
      if (!query) return true;
      var haystack = (String(record.name || "") + " " + dateTime(record.timestamp)).toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
    if (countEl) countEl.textContent = query ? records.length + " / " + savedRecords.length + " 条" : savedRecords.length + " 条记录";
    if (clearBtn) clearBtn.hidden = !query;
    if (!savedRecords.length) {
      list.innerHTML =
        '<div class="history-empty"><div class="empty-mark"><svg class="icon"><use href="#i-history"></use></svg></div>' +
        '<h3>还没有保存记录</h3><p>保存一次当前计算，之后可以随时恢复全部参数。</p>' +
        '<button class="primary-btn" type="button" data-empty-save>保存第一次计算</button></div>';
      return;
    }
    if (!records.length) {
      list.innerHTML =
        '<div class="history-empty"><div class="empty-mark"><svg class="icon"><use href="#i-search"></use></svg></div>' +
        '<h3>没有匹配的记录</h3><p>换个关键词试试，或者清空搜索条件。</p>' +
        '<button class="secondary-btn" type="button" data-history-clear-search>清空搜索</button></div>';
      return;
    }
    list.innerHTML = records.map(function (record) {
      var result = CostCalc.compute(record.state);
      var scenario = result.mode === "replacement" ? "替换价" : "当前价";
      return (
        '<article class="history-card">' +
          '<div class="history-card-head"><div><h3>' + escapeHtml(record.name) + '</h3><time>' + dateTime(record.timestamp) + '</time></div><span class="soft-tag">' + scenario + '</span></div>' +
          '<div class="history-metrics"><div><span>净利润</span><strong>' + money(result.net) + '</strong></div><div class="small-metric"><span>成交单均净利</span><strong>' + money(result.perDeal) + '</strong></div><div class="small-metric"><span>净利率</span><strong>' + pct(result.netMargin) + '</strong></div></div>' +
          '<div class="history-card-foot"><span>退货率 ' + pct(result.returnRate / 100) + '</span><span>仅退款率 ' + pct(result.refundRateActual / 100) + '</span><span>成交 ' + count(result.completed) + ' 单</span><span>费用 ' + money(result.totalFees) + '</span></div>' +
          '<div class="history-card-actions"><button class="secondary-btn" type="button" data-history-restore="' + escapeHtml(record.id) + '">恢复</button><button class="ghost-btn danger-text" type="button" data-history-delete="' + escapeHtml(record.id) + '">删除</button></div>' +
        '</article>'
      );
    }).join("");
  }

  function openSaveDialog() {
    var errors = validateInputs();
    if (errors.length) {
      showToast("请先修正：" + errors[0].message);
      return;
    }
    var result = CostCalc.compute(state);
    var dialog = $("#saveDialog");
    var name = $("#recordName");
    var summary = $("#dialogSummary");
    if (name) name.value = dateTime(new Date().toISOString()) + " · " + count(state.orders) + "单";
    if (summary) summary.innerHTML = "<span>净利润 <b>" + money(result.net) + "</b></span><span>成交单均 <b>" + money(result.perDeal) + "</b></span>";
    if (dialog && typeof dialog.showModal === "function") {
      dialog.showModal();
      window.setTimeout(function () { if (name) { name.focus(); name.select(); } }, 60);
    }
  }

  function saveRecord(name) {
    var errors = validateInputs();
    if (errors.length) {
      showToast("请先修正：" + errors[0].message);
      return false;
    }
    var result = CostCalc.compute(state);
    var record = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      name: String(name || "").trim() || (dateTime(new Date().toISOString()) + " · " + count(state.orders) + "单"),
      timestamp: new Date().toISOString(),
      state: clone(state),
      summary: {
        net: result.net,
        perDeal: result.perDeal,
        perOrder: result.perOrder,
        returnRate: result.returnRate,
        refundRate: result.refundRateActual,
        completed: result.completed,
        totalFees: result.totalFees,
        scenario: result.mode
      }
    };
    savedRecords.unshift(record);
    persistHistory();
    showToast("已保存到历史记录");
    return true;
  }

  function restoreRecord(id) {
    var record = savedRecords.filter(function (r) { return r.id === id; })[0];
    if (!record) return;
    state = CostCalc.sanitizeState(record.state);
    syncInputs();
    updateAll();
    persistDraft();
    navigate("calculator");
    showToast("已恢复「" + record.name + "」");
  }

  function deleteRecord(id) {
    var record = savedRecords.filter(function (r) { return r.id === id; })[0];
    if (!record) return;
    if (!window.confirm("删除记录「" + record.name + "」？")) return;
    savedRecords = savedRecords.filter(function (r) { return r.id !== id; });
    persistHistory();
    showToast("记录已删除");
  }

  function resetAll() {
    if (!window.confirm("恢复为示例数据？当前输入会被覆盖，历史记录不会删除。")) return;
    state = clone(DEFAULT_STATE);
    syncInputs();
    updateAll();
    persistDraft();
    showToast("已恢复示例数据");
  }

  function clearHistory() {
    if (!savedRecords.length) {
      showToast("历史记录已经是空的");
      return;
    }
    if (!window.confirm("清空所有历史记录？此操作不可撤销。")) return;
    savedRecords = [];
    persistHistory();
    showToast("历史记录已清空");
  }

  function downloadFile(filename, content, type) {
    var blob = new Blob([content], { type: type || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 800);
  }

  function stamp() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function exportAll() {
    var payload = {
      app: "成本利润计算器",
      version: 1,
      exportedAt: new Date().toISOString(),
      current: state,
      records: savedRecords
    };
    downloadFile("成本利润_数据_" + stamp() + ".json", JSON.stringify(payload, null, 2), "application/json");
    showToast("数据已导出");
  }

  function exportCsv() {
    if (!savedRecords.length) {
      showToast("还没有历史记录可以导出");
      return;
    }
    var header = ["记录名称", "保存时间", "方案", "净利润", "成交单均", "含退货均摊", "退货率", "成交单", "订单数"];
    var rows = savedRecords.map(function (record) {
      var r = CostCalc.compute(record.state);
      return [
        record.name,
        record.timestamp,
        r.mode === "replacement" ? "替换价" : "当前价",
        r.net.toFixed(2),
        r.perDeal.toFixed(2),
        r.perOrder.toFixed(2),
        (r.returnRate).toFixed(2),
        r.completed,
        r.orders
      ];
    });
    var csv = "\uFEFF" + [header].concat(rows).map(function (row) {
      return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    downloadFile("成本利润_历史_" + stamp() + ".csv", csv, "text/csv;charset=utf-8");
    showToast("历史 CSV 已导出");
  }

  function importData() {
    var input = $("#importFile");
    if (input) {
      input.value = "";
      input.click();
    }
  }

  function applyImport(text) {
    var data = JSON.parse(text);
    var candidateState = data.current || data.state || data;
    if (!candidateState || typeof candidateState !== "object") throw new Error("没有找到有效参数");
    var rawRecords = Array.isArray(data.records) ? data.records : (Array.isArray(data.history) ? data.history : []);
    if (!window.confirm("导入会覆盖当前参数" + (rawRecords.length ? "和历史记录" : "") + "，继续？")) return;
    state = CostCalc.sanitizeState(candidateState);
    if (rawRecords.length) {
      savedRecords = rawRecords.map(normalizeRecord).filter(Boolean).slice(0, MAX_HISTORY);
      writeStorage(LS_HISTORY, JSON.stringify(savedRecords));
    }
    syncInputs();
    updateAll();
    persistDraft();
    renderHistory();
    showToast("数据已导入");
  }

  function shareSummary() {
    var result = CostCalc.compute(state);
    var text = [
      "成本利润测算",
      "售价 " + money(state.price) + " · " + count(state.orders) + " 单",
      "退货率 " + pct(result.returnRate / 100) + " · 仅退款率 " + pct(result.refundRateActual / 100) + "（" + count(result.refunds) + " 个）",
      "净利润 " + money(result.net) + " · 总费用 " + money(result.totalFees),
      "成交单均净利 " + money(result.perDeal) + " · 含退货下单均摊 " + money(result.perOrder),
      "净利率 " + pct(result.netMargin) + " · 保本售价 " + money(result.breakEven)
    ].join("\n");
    if (navigator.share) {
      navigator.share({ title: "成本利润测算", text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast("摘要已复制"); }).catch(function () { showToast("复制失败，请手动选择文本"); });
    } else {
      copyTextFallback(text);
    }
  }

  function copyTextFallback(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand("copy"); showToast("摘要已复制"); } catch (e) { showToast("复制失败"); }
    textarea.remove();
  }

  function showToast(message) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    window.clearTimeout(el._timer);
    el._timer = window.setTimeout(function () { el.classList.remove("is-visible"); }, 2600);
  }

  function openMenu() {
    var menu = $("#menuPanel");
    var btn = $("#menuBtn");
    if (!menu || !btn) return;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    var menu = $("#menuPanel");
    var btn = $("#menuBtn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    var menu = $("#menuPanel");
    if (menu && menu.hidden) openMenu(); else closeMenu();
  }

  function handleAction(action) {
    closeMenu();
    if (action === "save") openSaveDialog();
    else if (action === "share") shareSummary();
    else if (action === "export") exportAll();
    else if (action === "import") importData();
    else if (action === "export-csv") exportCsv();
    else if (action === "install-help") openInstallDialog();
    else if (action === "reset") resetAll();
    else if (action === "clear-history") clearHistory();
  }

  function openInstallDialog() {
    var dialog = $("#installDialog");
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }

  function closeInstallDialog() {
    var dialog = $("#installDialog");
    if (dialog && typeof dialog.close === "function") dialog.close();
  }

  function onFieldInput(event) {
    var el = event.target;
    if (!el || !el.dataset || !el.dataset.field) return;
    var field = el.dataset.field;
    var raw = el.value;

    var itemId = el.dataset.itemId;
    var feeId = el.dataset.feeId;
    if (itemId) {
      var item = state.items.filter(function (entry) { return entry.id === itemId; })[0];
      if (!item) return;
      if (el.dataset.prop === "name") item.name = raw;
      else if (el.dataset.prop === "current") item.current = raw === "" ? 0 : Number(raw);
      else if (el.dataset.prop === "replacement") item.replacement = raw === "" ? "" : Number(raw);
      else return;
      updateAll();
      scheduleSave();
      return;
    }
    if (feeId) {
      var fee = state.feeItems.filter(function (entry) { return entry.id === feeId; })[0];
      if (!fee) return;
      if (el.dataset.prop === "name") fee.name = raw;
      else if (el.dataset.prop === "basis") fee.basis = raw === "return" ? "return" : "deal";
      else if (el.dataset.prop === "value") fee.value = raw === "" ? 0 : Number(raw);
      else return;
      updateAll();
      scheduleSave();
      return;
    }

    if (field === "refundOverride") {
      state.refundOverride = raw === "" ? "" : raw;
    } else if (field === "returnRate" || field === "refundRate") {
      state[field] = raw === "" ? 0 : Number(raw);
      if (field === "refundRate" && state.refundOverride !== "") {
        state.refundOverride = "";
        var autoInput = $("#refundOverride");
        if (autoInput) autoInput.value = "";
      }
      setRangeValue(field === "returnRate" ? $("#returnRange") : $("#refundRange"), state[field]);
    } else if (field === "price") {
      state.price = raw === "" ? 0 : Number(raw);
    } else if (field === "orders") {
      state.orders = raw === "" ? 0 : Number(raw);
    } else if (field === "shipping") {
      state.shipping = raw === "" ? 0 : Number(raw);
    } else {
      return;
    }
    updateAll();
    scheduleSave();
  }

  function onRangeInput(event, field) {
    var value = Number(event.target.value);
    state[field] = value;
    if (field === "refundRate" && state.refundOverride !== "") {
      state.refundOverride = "";
      var autoInput = $("#refundOverride");
      if (autoInput) autoInput.value = "";
    }
    var number = field === "returnRate" ? $("#returnRate") : $("#refundRate");
    if (number) number.value = value.toFixed(2);
    setRangeValue(event.target, value);
    updateAll();
    scheduleSave();
  }

  function newId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5);
  }

  function addCostItem() {
    var item = { id: newId("item"), name: "新配件", note: "自定义配件", current: 0, replacement: "" };
    state.items.push(item);
    syncInputs();
    updateAll();
    persistDraft();
    window.setTimeout(function () {
      var input = document.querySelector('[data-item-id="' + item.id + '"][data-prop="name"]');
      if (input) { input.focus(); input.select(); }
    }, 30);
    showToast("已添加配件，可直接改名称和价格");
  }

  function removeCostItem(id) {
    var item = state.items.filter(function (entry) { return entry.id === id; })[0];
    if (!item) return;
    if (!window.confirm("删除配件「" + item.name + "」？")) return;
    state.items = state.items.filter(function (entry) { return entry.id !== id; });
    syncInputs();
    updateAll();
    persistDraft();
    showToast("已删除「" + item.name + "」");
  }

  function addFeeItem() {
    var fee = { id: newId("fee"), name: "新费用", basis: "deal", note: "自定义费用", value: 0 };
    state.feeItems.push(fee);
    syncInputs();
    updateAll();
    persistDraft();
    window.setTimeout(function () {
      var input = document.querySelector('[data-fee-id="' + fee.id + '"][data-prop="name"]');
      if (input) { input.focus(); input.select(); }
    }, 30);
    showToast("已添加费用，可选择计费基数");
  }

  function removeFeeItem(id) {
    var fee = state.feeItems.filter(function (entry) { return entry.id === id; })[0];
    if (!fee) return;
    var extra = id === "returnShipping" ? "\n删除后，仅退款净损失不再冲减退货运费。" : "";
    if (!window.confirm("删除费用「" + fee.name + "」？" + extra)) return;
    state.feeItems = state.feeItems.filter(function (entry) { return entry.id !== id; });
    syncInputs();
    updateAll();
    persistDraft();
    showToast("已删除「" + fee.name + "」");
  }

  function bindEvents() {
    document.addEventListener("input", onFieldInput);
    document.addEventListener("change", function (e) {
      if (e.target && e.target.matches("[data-fee-id][data-prop='basis']")) onFieldInput(e);
    });
    $("#returnRange").addEventListener("input", function (e) { onRangeInput(e, "returnRate"); });
    $("#refundRange").addEventListener("input", function (e) { onRangeInput(e, "refundRate"); });

    $("#addCostBtn").addEventListener("click", addCostItem);
    $("#addFeeBtn").addEventListener("click", addFeeItem);

    $("#refundAutoBtn").addEventListener("click", function () {
      state.refundOverride = "";
      var input = $("#refundOverride");
      if (input) input.value = "";
      updateAll();
      scheduleSave();
    });

    $$("#scenarioSwitch [data-scenario]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.scenario = btn.dataset.scenario;
        updateAll();
        scheduleSave();
      });
    });
    $("#scenarioToggle").addEventListener("click", toggleScenario);
    $("#mobileScenarioToggle").addEventListener("click", toggleScenario);

    $("#themeBtn").addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
    });

    $("#saveBtn").addEventListener("click", openSaveDialog);
    $("#saveBtn2").addEventListener("click", openSaveDialog);
    $("#historySaveBtn").addEventListener("click", openSaveDialog);
    $("#shareBtn").addEventListener("click", shareSummary);

    $("#menuBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    document.addEventListener("click", function (e) {
      var removeCost = e.target.closest("[data-remove-item]");
      if (removeCost) {
        e.preventDefault();
        removeCostItem(removeCost.dataset.removeItem);
        return;
      }
      var removeFee = e.target.closest("[data-remove-fee]");
      if (removeFee) {
        e.preventDefault();
        removeFeeItem(removeFee.dataset.removeFee);
        return;
      }
      var action = e.target.closest("[data-action]");
      if (action) {
        e.preventDefault();
        handleAction(action.dataset.action);
        return;
      }
      var view = e.target.closest("button[data-view], a[data-view]");
      if (view) {
        e.preventDefault();
        navigate(view.dataset.view);
        return;
      }
      var emptySave = e.target.closest("[data-empty-save]");
      if (emptySave) {
        openSaveDialog();
        return;
      }
      if (!e.target.closest("#menuPanel") && !e.target.closest("#menuBtn")) closeMenu();
    });

    $("#saveForm").addEventListener("submit", function (e) {
      var submitter = e.submitter;
      if (submitter && submitter.value === "cancel") return;
      e.preventDefault();
      var name = $("#recordName") ? $("#recordName").value : "";
      if (saveRecord(name)) {
        var dialog = $("#saveDialog");
        if (dialog) dialog.close();
      }
    });

    $("#confirmSave").addEventListener("click", function (e) {
      e.preventDefault();
      var name = $("#recordName") ? $("#recordName").value : "";
      if (saveRecord(name)) {
        var dialog = $("#saveDialog");
        if (dialog) dialog.close();
      }
    });

    $("#targetProfit").addEventListener("input", function () {
      renderTarget(CostCalc.compute(state));
    });

    $("#importFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try { applyImport(text); } catch (err) { showToast("导入失败：文件格式不正确"); }
      }).catch(function () { showToast("读取文件失败"); });
    });

    $("#historyList").addEventListener("click", function (e) {
      var restore = e.target.closest("[data-history-restore]");
      if (restore) { restoreRecord(restore.dataset.historyRestore); return; }
      var del = e.target.closest("[data-history-delete]");
      if (del) { deleteRecord(del.dataset.historyDelete); return; }
      if (e.target.closest("[data-history-clear-search]")) {
        historyQuery = "";
        var search = $("#historySearch");
        if (search) search.value = "";
        renderHistory();
        if (search) search.focus();
      }
    });

    $("#historySearch").addEventListener("input", function () {
      historyQuery = this.value || "";
      renderHistory();
    });
    $("#historySearchClear").addEventListener("click", function () {
      historyQuery = "";
      $("#historySearch").value = "";
      renderHistory();
      $("#historySearch").focus();
    });

    $("#heatmap").addEventListener("click", function (e) {
      var cell = e.target.closest("td[data-orders]");
      if (!cell) return;
      state.orders = Number(cell.dataset.orders);
      state.returnRate = Number(cell.dataset.rate);
      syncInputs();
      updateAll();
      persistDraft();
      navigate("calculator");
      showToast("已应用：" + count(state.orders) + " 单 / " + pct(state.returnRate / 100));
    });

    $("#compareCards").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-compare-scenario]");
      if (!btn) return;
      state.scenario = btn.dataset.compareScenario === "replacement" ? "replacement" : "current";
      updateAll();
      persistDraft();
      navigate("calculator");
      showToast("已切换到" + (state.scenario === "replacement" ? "替换价" : "当前价") + "计算");
    });

    $("#detailBtn").addEventListener("click", function () {
      var target = $(".result-column");
      if (target) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });

    $$("[data-close-install]").forEach(function (el) {
      el.addEventListener("click", closeInstallDialog);
    });
    $("#installDialog").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeInstallDialog();
    });

    window.addEventListener("scroll", function () {
      window.requestAnimationFrame(updateStickyVisibility);
    }, { passive: true });
    window.addEventListener("resize", updateStickyVisibility);

    window.addEventListener("hashchange", function () {
      navigate((location.hash || "#calculator").slice(1), false);
    });
    window.addEventListener("popstate", function () {
      navigate((location.hash || "#calculator").slice(1), false);
    });

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      var install = $("#installBtn");
      if (install) install.hidden = false;
    });

    $("#installBtn").addEventListener("click", function () {
      if (!deferredPrompt) {
        openInstallDialog();
        return;
      }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        var install = $("#installBtn");
        if (install) install.hidden = true;
      }).catch(function () {});
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeMenu();
        closeInstallDialog();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        openSaveDialog();
      }
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!(location.protocol === "http:" || location.protocol === "https:")) return;
    if (window.__SINGLE_FILE__) return;
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  }

  function init() {
    applyTheme(initialTheme());
    syncInputs();
    updateAll();
    renderHistory();
    bindEvents();

    var initial = (location.hash || "#calculator").slice(1);
    navigate(VIEWS.indexOf(initial) !== -1 ? initial : "calculator", false);
    registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

