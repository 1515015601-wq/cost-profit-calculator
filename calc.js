/**
 * 成本利润计算核心（支持动态配件 / 动态费用）
 * 浏览器：window.CostCalc
 * Node：module.exports
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CostCalc = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_COST_ITEMS = [
    { id: "decoy", name: "诱骗器", note: "核心配件", current: 2.3, replacement: "" },
    { id: "magnet", name: "磁铁", note: "按单件用量", current: 2.3, replacement: "" },
    { id: "fan", name: "风扇", note: "按单件用量", current: 1.6, replacement: "" },
    { id: "aluminum", name: "铝片", note: "按单件用量", current: 2.5, replacement: "" },
    { id: "cooler", name: "制冷片", note: "单价最高，优先优化", current: 9.7, replacement: "" },
    { id: "grease", name: "硅脂", note: "按每次 0.03 元", current: 0.03, replacement: "" },
    { id: "box", name: "箱子", note: "后期可替换为 0.10 元", current: 0.72, replacement: 0.1 },
    { id: "card", name: "卡片", note: "包装卡片", current: 0.09, replacement: "" },
    { id: "bubble", name: "气泡", note: "缓冲包装", current: 0.1, replacement: "" },
    { id: "shell", name: "外壳", note: "后期可替换为 0.04 元", current: 0.72, replacement: 0.04 },
    { id: "magnetic", name: "磁吸片", note: "按单件用量", current: 0.36, replacement: "" }
  ];

  const DEFAULT_FEE_ITEMS = [
    { id: "deduction", name: "扣款", basis: "deal", note: "按实际成交单均摊", value: 0.767 },
    { id: "tech", name: "技术服务费", basis: "deal", note: "按实际成交单均摊", value: 0.262 },
    { id: "lostShipping", name: "损失快递费", basis: "return", note: "退货导致的首程快递损失", value: 3 },
    { id: "packaging", name: "包装费", basis: "return", note: "退回包装不可再用", value: 1 },
    { id: "returnShipping", name: "退货快递费", basis: "return", note: "仅退款不退回时不计", value: 5 }
  ];

  const DEFAULT_STATE = {
    version: 2,
    price: 35.5,
    orders: 1140,
    returnRate: 12.280701754385966,
    refundRate: 7.142857142857142,
    refundOverride: "",
    items: DEFAULT_COST_ITEMS.map(function (item) { return Object.assign({}, item); }),
    shipping: 1.95,
    feeItems: DEFAULT_FEE_ITEMS.map(function (item) { return Object.assign({}, item); }),
    scenario: "current"
  };

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function num(value, fallback) {
    if (value === "" || value === null || value === undefined) return fallback === undefined ? 0 : fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hasValue(value) {
    return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function safeId(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function uniqueId(base, used) {
    let id = base || "item";
    let i = 2;
    while (used.has(id)) {
      id = base + "-" + i;
      i += 1;
    }
    used.add(id);
    return id;
  }

  function normalizeItems(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    let list;
    if (Array.isArray(source.items)) {
      list = source.items;
    } else if (source.costs && typeof source.costs === "object") {
      const legacyReplacement = source.replacement || {};
      list = DEFAULT_COST_ITEMS.map(function (item) {
        return {
          id: item.id,
          name: item.name,
          note: item.note,
          current: source.costs[item.id],
          replacement: legacyReplacement[item.id]
        };
      });
    } else {
      list = DEFAULT_COST_ITEMS;
    }
    const used = new Set();
    return list.map(function (item, index) {
      const fallback = DEFAULT_COST_ITEMS[index] || { id: "item-" + (index + 1), name: "配件 " + (index + 1), note: "自定义配件", current: 0, replacement: "" };
      const id = uniqueId(safeId(item && item.id, fallback.id), used);
      return {
        id: id,
        name: String((item && item.name) || fallback.name).slice(0, 30),
        note: String((item && item.note) || fallback.note).slice(0, 80),
        current: Math.max(0, num(item && item.current, fallback.current)),
        replacement: hasValue(item && item.replacement) ? Math.max(0, Number(item.replacement)) : ""
      };
    });
  }

  function normalizeFees(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    let list;
    if (Array.isArray(source.feeItems)) {
      list = source.feeItems;
    } else if (source.fees && typeof source.fees === "object") {
      list = DEFAULT_FEE_ITEMS.map(function (item) {
        return {
          id: item.id,
          name: item.name,
          basis: item.basis,
          note: item.note,
          value: source.fees[item.id]
        };
      });
    } else {
      list = DEFAULT_FEE_ITEMS;
    }
    const used = new Set();
    return list.map(function (item, index) {
      const fallback = DEFAULT_FEE_ITEMS[index] || { id: "fee-" + (index + 1), name: "费用 " + (index + 1), basis: "deal", note: "自定义费用", value: 0 };
      return {
        id: uniqueId(safeId(item && item.id, fallback.id), used),
        name: String((item && item.name) || fallback.name).slice(0, 30),
        basis: item && item.basis === "return" ? "return" : "deal",
        note: String((item && item.note) || fallback.note).slice(0, 80),
        value: Math.max(0, num(item && item.value, fallback.value))
      };
    });
  }

  function sanitizeState(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      version: 2,
      price: Math.max(0, num(source.price, DEFAULT_STATE.price)),
      orders: Math.max(0, Math.round(num(source.orders, DEFAULT_STATE.orders))),
      returnRate: clamp(num(source.returnRate, DEFAULT_STATE.returnRate), 0, 100),
      refundRate: clamp(num(source.refundRate, DEFAULT_STATE.refundRate), 0, 100),
      refundOverride: hasValue(source.refundOverride) ? Math.max(0, Math.round(Number(source.refundOverride))) : "",
      items: normalizeItems(source),
      shipping: Math.max(0, num(source.shipping, DEFAULT_STATE.shipping)),
      feeItems: normalizeFees(source),
      scenario: source.scenario === "replacement" ? "replacement" : "current"
    };
  }

  function costFor(item, mode) {
    const current = Math.max(0, num(item && item.current, 0));
    if (mode !== "replacement") return current;
    return hasValue(item && item.replacement) ? Math.max(0, Number(item.replacement)) : current;
  }

  function goodsCost(state, mode) {
    return state.items.reduce(function (sum, item) {
      return sum + costFor(item, mode);
    }, 0);
  }

  function feeUnit(state, basis) {
    return state.feeItems.reduce(function (sum, fee) {
      return sum + (fee.basis === basis ? Math.max(0, num(fee.value, 0)) : 0);
    }, 0);
  }

  function findRefundShipping(state) {
    const item = state.feeItems.filter(function (fee) { return fee.id === "returnShipping"; })[0];
    return item ? Math.max(0, num(item.value, 0)) : 0;
  }

  /**
   * 核心计算
   * @param {object} state
   * @param {object} options { mode, orders, returnRate, refundOverride }
   */
  function compute(state, options) {
    const opts = options || {};
    const source = sanitizeState(state);
    const mode = opts.mode === "replacement" ? "replacement" : (opts.mode === "current" ? "current" : source.scenario);
    const price = Math.max(0, num(opts.price !== undefined ? opts.price : source.price, 0));
    const orders = Math.max(0, Math.round(num(opts.orders !== undefined ? opts.orders : source.orders, 0)));
    const returnRate = clamp(num(opts.returnRate !== undefined ? opts.returnRate : source.returnRate, 0), 0, 100);
    const refundRate = clamp(num(opts.refundRate !== undefined ? opts.refundRate : source.refundRate, 0), 0, 100);

    const returnsRaw = orders * returnRate / 100;
    const returns = clamp(Math.round(returnsRaw), 0, orders);
    const refundsAutoRaw = returns * refundRate / 100;
    const refundsAuto = clamp(Math.round(refundsAutoRaw), 0, returns);

    const override = opts.refundOverride !== undefined ? opts.refundOverride : source.refundOverride;
    const refundsIsManual = hasValue(override);
    const refunds = refundsIsManual
      ? clamp(Math.round(Number(override)), 0, returns)
      : refundsAuto;

    const completed = Math.max(0, orders - returns);
    const goods = goodsCost(source, mode);
    const unitCost = goods + Math.max(0, source.shipping);

    const revenue = completed * price;
    const cogs = completed * unitCost;
    const dealFeeUnit = feeUnit(source, "deal");
    const dealFees = completed * dealFeeUnit;
    const returnBaseUnit = feeUnit(source, "return");
    const returnBaseFees = returns * returnBaseUnit;
    const refundShipping = findRefundShipping(source);
    const refundLossUnit = Math.max(0, goods - refundShipping);
    const refundLoss = refunds * refundLossUnit;
    const returnRefundFees = returnBaseFees + refundLoss;
    const feeBaseTotal = dealFees + returnBaseFees;
    const totalFees = dealFees + returnRefundFees;
    const net = revenue - cogs - totalFees;
    const totalCost = cogs + totalFees;
    const netMargin = revenue > 0 ? net / revenue : 0;
    const perDeal = completed > 0 ? net / completed : 0;
    const perOrder = orders > 0 ? net / orders : 0;
    const breakEven = completed > 0 ? totalCost / completed : 0;
    const costMargin = totalCost > 0 ? net / totalCost : 0;

    return {
      mode: mode,
      price: price,
      orders: orders,
      returnRate: returnRate,
      refundRate: refundRate,
      returns: returns,
      refundsAuto: refundsAuto,
      refunds: refunds,
      refundsIsManual: refundsIsManual,
      refundRateActual: returns > 0 ? refunds / returns * 100 : 0,
      completed: completed,
      goodsCost: goods,
      shipping: source.shipping,
      unitCost: unitCost,
      revenue: revenue,
      cogs: cogs,
      dealFeeUnit: dealFeeUnit,
      dealFees: dealFees,
      returnBaseUnit: returnBaseUnit,
      returnBaseFees: returnBaseFees,
      refundShipping: refundShipping,
      refundLossUnit: refundLossUnit,
      refundLoss: refundLoss,
      returnRefundFees: returnRefundFees,
      feeBaseTotal: feeBaseTotal,
      totalFees: totalFees,
      net: net,
      totalCost: totalCost,
      netMargin: netMargin,
      perDeal: perDeal,
      perOrder: perOrder,
      breakEven: breakEven,
      costMargin: costMargin
    };
  }

  function compare(state) {
    const current = compute(state, { mode: "current" });
    const replacement = compute(state, { mode: "replacement" });
    return {
      current: current,
      replacement: replacement,
      deltaNet: replacement.net - current.net,
      deltaPerDeal: replacement.perDeal - current.perDeal,
      deltaBreakEven: replacement.breakEven - current.breakEven,
      deltaGoods: replacement.goodsCost - current.goodsCost,
      deltaRefundLoss: replacement.refundLoss - current.refundLoss
    };
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.map(function (v) { return Math.round(Number(v) * 100) / 100; }).filter(Number.isFinite)))
      .sort(function (a, b) { return a - b; });
  }

  function sensitivity(state, options) {
    const opts = options || {};
    const base = sanitizeState(state);
    const mode = opts.mode || base.scenario;
    const ordersList = uniqueSorted((opts.orders || [500, 800, 1000, 1140, 1500, 2000, 3000, 5000]).concat([base.orders]));
    const ratesList = uniqueSorted((opts.rates || [0, 3, 5, 8, 10, 12, 15, 20, 25, 30]).concat([base.returnRate]));
    const rows = ratesList.map(function (rate) {
      const cols = ordersList.map(function (orders) {
        const result = compute(base, {
          mode: mode,
          orders: orders,
          returnRate: rate,
          refundOverride: ""
        });
        return {
          orders: orders,
          returnRate: rate,
          net: result.net,
          perDeal: result.perDeal,
          returns: result.returns,
          completed: result.completed
        };
      });
      return { rate: rate, cols: cols };
    });
    const values = rows.reduce(function (all, row) {
      row.cols.forEach(function (cell) { all.push(cell.net); });
      return all;
    }, []);
    return {
      ordersList: ordersList,
      ratesList: ratesList,
      rows: rows,
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      mode: mode
    };
  }

  function reverseTarget(state, targetProfit) {
    const result = compute(state);
    const target = Math.max(0, num(targetProfit, 0));
    return {
      target: target,
      deals: result.perDeal > 0 ? Math.ceil(target / result.perDeal) : null,
      orders: result.perOrder > 0 ? Math.ceil(target / result.perOrder) : null,
      perDeal: result.perDeal,
      perOrder: result.perOrder
    };
  }

  function validate(state) {
    const s = sanitizeState(state);
    const errors = [];
    const result = compute(s);
    if (!(s.price > 0)) errors.push({ key: "price", message: "售价必须大于 0" });
    if (!(s.orders > 0)) errors.push({ key: "orders", message: "订单数必须大于 0" });
    if (s.returnRate < 0 || s.returnRate > 100) errors.push({ key: "returnRate", message: "退货率应在 0%–100%" });
    if (s.refundRate < 0 || s.refundRate > 100) errors.push({ key: "refundRate", message: "仅退款率应在 0%–100%" });
    if (s.refundOverride !== "" && s.refundOverride > result.returns) {
      errors.push({ key: "refundOverride", message: "实际仅退款数不能大于退货数" });
    }
    s.items.forEach(function (item) {
      if (item.current < 0) errors.push({ key: "items." + item.id + ".current", message: item.name + "成本不能为负" });
    });
    s.feeItems.forEach(function (fee) {
      if (fee.value < 0) errors.push({ key: "feeItems." + fee.id + ".value", message: fee.name + "费用不能为负" });
    });
    return { ok: errors.length === 0, errors: errors, result: result };
  }

  return {
    VERSION: 2,
    COST_ITEMS: DEFAULT_COST_ITEMS,
    FEE_ITEMS: DEFAULT_FEE_ITEMS,
    DEFAULT_STATE: DEFAULT_STATE,
    clone: clone,
    sanitizeState: sanitizeState,
    compute: compute,
    compare: compare,
    sensitivity: sensitivity,
    reverseTarget: reverseTarget,
    validate: validate
  };
});
