/* MK!Solver — user interface. Depends on CHEngine (engine.js) and CHExamples. */
(function () {
  'use strict';
  const E = window.CHEngine;
  const EXAMPLES = window.CHExamples || [];
  const STORE_KEY = 'mk-solver:model:v1';
  const PREF_KEY = 'mk-solver:prefs:v1';
  // Saved under the project's earlier name, CH!Solver; read once and carried over.
  const OLD_KEYS = { [STORE_KEY]: 'ch-solver:model:v1', [PREF_KEY]: 'ch-solver:prefs:v1' };
  const readStore = (key) => localStorage.getItem(key) ?? localStorage.getItem(OLD_KEYS[key]);

  const $ = (sel) => document.querySelector(sel);
  const fmt = (x) => E.formatNumber(x, 8);
  const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);

  // ------------------------------------------------------------------ state

  let state = blankState();
  let model = E.buildModel(state.rules);
  let outputs = {};          // name -> number, display units
  let ruleStatus = [];
  let shownVars = [];        // variable order currently rendered
  let prefs = { autoGuess: true, autoSolve: false, tab: 'plot', size: 0 };

  function blankState() {
    return { title: 'Untitled', rules: [''], vars: {}, units: [], lists: {}, plot: { x: '', y: [] } };
  }
  function vdata(name) {
    if (!state.vars[name]) state.vars[name] = { st: '', input: '', unit: '', comment: '' };
    const d = state.vars[name];
    d.st = d.st || ''; d.input = d.input == null ? '' : String(d.input); d.unit = d.unit || ''; d.comment = d.comment || '';
    return d;
  }
  function normalizeState(s) {
    const out = blankState();
    if (!s || typeof s !== 'object') return out;
    out.title = typeof s.title === 'string' ? s.title : 'Untitled';
    out.rules = Array.isArray(s.rules) && s.rules.length ? s.rules.map(String) : [''];
    out.vars = {};
    for (const [k, v] of Object.entries(s.vars || {})) {
      out.vars[k] = { st: String(v.st || '').toUpperCase(), input: v.input == null ? '' : String(v.input), unit: String(v.unit || ''), comment: String(v.comment || '') };
    }
    out.units = Array.isArray(s.units) ? s.units.map((u) => ({ from: String(u.from || ''), to: String(u.to || ''), factor: String(u.factor == null ? '' : u.factor), offset: String(u.offset == null ? '' : u.offset) })) : [];
    out.lists = {};
    for (const [k, l] of Object.entries(s.lists || {})) {
      const values = Array.isArray(l) ? l : (l && Array.isArray(l.values) ? l.values : []);
      out.lists[k] = { values: values.map((x) => (x == null ? '' : String(x))), computed: !!(l && l.computed) };
    }
    out.plot = { x: (s.plot && s.plot.x) || '', y: (s.plot && Array.isArray(s.plot.y)) ? s.plot.y.slice() : [] };
    if (out.rules[out.rules.length - 1].trim() !== '') out.rules.push('');
    return out;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* storage unavailable */ }
  }
  function loadSaved() {
    try {
      const p = JSON.parse(readStore(PREF_KEY) || 'null');
      if (p) prefs = Object.assign(prefs, p);
    } catch (_) { /* ignore */ }
    try {
      const raw = readStore(STORE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (_) { /* ignore */ }
    return null;
  }

  // ------------------------------------------------------------------ helpers

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  function setStatus(msg, kind, tags) {
    const el = $('#status-msg');
    el.className = 'status-msg' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    for (const t of tags || []) el.append(h('span', { class: 'tag', text: t }));
  }

  function units() { return E.makeUnits(state.units); }

  // ------------------------------------------------------------------ rules

  function rebuildModel() {
    model = E.buildModel(state.rules);
    ruleStatus = model.rules.map((r) => (r.blank ? 'blank' : r.ok ? '' : 'error'));
  }

  function renderRules(focusIndex, caret) {
    const body = $('#rule-body');
    body.textContent = '';
    state.rules.forEach((src, i) => {
      const input = h('input', {
        id: `rule-${i}`, value: src, spellcheck: 'false', autocomplete: 'off', 'aria-label': `Rule ${i + 1}`,
        placeholder: i === state.rules.length - 1 ? (i === 0 ? 'e.g.  c^2 = a^2 + b^2' : 'new rule…') : '',
        'data-row': i,
      });
      input.addEventListener('input', () => onRuleInput(i, input));
      input.addEventListener('keydown', (ev) => onRuleKey(ev, i, input));
      input.addEventListener('paste', (ev) => onRulePaste(ev, i, input));
      body.append(h('tr', { id: `rule-row-${i}` }, h('td', { class: 'st', id: `rule-st-${i}` }), h('td', {}, input)));
    });
    paintRuleStatus();
    if (focusIndex != null) {
      const el = $(`#rule-${focusIndex}`);
      if (el) { el.focus(); const c = caret == null ? el.value.length : caret; el.setSelectionRange(c, c); }
    }
  }

  function paintRuleStatus() {
    state.rules.forEach((_, i) => {
      const td = $(`#rule-st-${i}`);
      const tr = $(`#rule-row-${i}`);
      if (!td) return;
      const st = ruleStatus[i] || '';
      const rule = model.rules[i];
      td.className = 'st ' + st;
      td.textContent = st === 'unsatisfied' ? '*' : st === 'error' ? '!' : st === 'unsolved' ? '·' : '';
      td.title = st === 'error' && rule ? `Syntax error: ${rule.error}` : st === 'unsatisfied' ? 'Rule not satisfied' : st === 'unsolved' ? 'Not solved yet' : '';
      tr.classList.toggle('error', st === 'error');
    });
  }

  function onRuleInput(i, input) {
    state.rules[i] = input.value;
    let structural = false;
    if (i === state.rules.length - 1 && input.value.trim() !== '') { state.rules.push(''); structural = true; }
    rebuildModel();
    if (structural) renderRules(i, input.selectionStart);
    else paintRuleStatus();
    syncVariables();
    save();
    if (prefs.autoSolve) solveNow(true);
  }

  function onRuleKey(ev, i, input) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const pos = input.selectionStart;
      const before = input.value.slice(0, pos), after = input.value.slice(pos);
      state.rules[i] = before;
      state.rules.splice(i + 1, 0, after);
      rebuildModel(); renderRules(i + 1, 0); syncVariables(); save();
    } else if (ev.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && i > 0) {
      ev.preventDefault();
      const prevLen = state.rules[i - 1].length;
      state.rules[i - 1] += state.rules[i];
      state.rules.splice(i, 1);
      if (!state.rules.length || state.rules[state.rules.length - 1].trim() !== '') state.rules.push('');
      rebuildModel(); renderRules(i - 1, prevLen); syncVariables(); save();
    } else if (ev.key === 'ArrowUp' && i > 0) {
      ev.preventDefault(); $(`#rule-${i - 1}`).focus();
    } else if (ev.key === 'ArrowDown' && i < state.rules.length - 1) {
      ev.preventDefault(); $(`#rule-${i + 1}`).focus();
    }
  }

  function onRulePaste(ev, i, input) {
    const text = (ev.clipboardData || window.clipboardData).getData('text');
    if (!text || !/\n/.test(text)) return;
    ev.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n');
    const pos = input.selectionStart, end = input.selectionEnd;
    const before = input.value.slice(0, pos), after = input.value.slice(end);
    lines[0] = before + lines[0];
    const lastLen = lines[lines.length - 1].length;
    lines[lines.length - 1] += after;
    state.rules.splice(i, 1, ...lines);
    if (state.rules[state.rules.length - 1].trim() !== '') state.rules.push('');
    rebuildModel(); renderRules(i + lines.length - 1, lastLen); syncVariables(); save();
  }

  // ------------------------------------------------------------------ variables

  function syncVariables() {
    const names = model.variables;
    if (names.join('\u0000') !== shownVars.join('\u0000')) renderVariables();
  }

  const VAR_COLS = ['st', 'in', 'unit', 'com'];

  function renderVariables() {
    const active = document.activeElement && document.activeElement.id;
    const sel = active && document.activeElement.selectionStart;
    shownVars = model.variables.slice();
    const body = $('#var-body');
    body.textContent = '';
    if (!shownVars.length) {
      body.append(h('tr', { class: 'empty' }, h('td', { colspan: 6, text: 'Variables appear here as you type rules.' })));
    }
    shownVars.forEach((name, row) => {
      const d = vdata(name);
      const cell = (col, value, extra) => {
        const input = h('input', Object.assign({
          id: `var-${col}-${name}`, value, spellcheck: 'false', autocomplete: 'off', 'data-row': row, 'data-col': col,
          'aria-label': `${name} ${({ st: 'status', in: 'input', unit: 'unit', com: 'comment' })[col]}`,
        }, extra || {}));
        input.addEventListener('input', () => onVarInput(name, col, input));
        input.addEventListener('keydown', (ev) => onGridKey(ev, '#var-body', col, row, shownVars.length, (r, c) => `#var-${c}-${shownVars[r]}`));
        return input;
      };
      const out = h('td', { class: 'out cell', id: `var-out-${name}`, title: 'Double-click to move to Input' });
      out.addEventListener('dblclick', () => moveOutputToInput(name));
      const tr = h('tr', { id: `var-row-${name}` },
        h('td', { class: 'st' }, cell('st', d.st, { maxlength: 1, inputmode: 'text' })),
        h('td', { class: 'in' }, cell('in', d.input, { inputmode: 'decimal' })),
        h('td', { class: 'name cell', text: name }),
        out,
        h('td', { class: 'unit' }, cell('unit', d.unit)),
        h('td', { class: 'com' }, cell('com', d.comment)),
      );
      body.append(tr);
    });
    paintOutputs(false);
    if (active) {
      const el = document.getElementById(active);
      if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (_) { /* not text */ } }
    }
    renderLists();
    renderPlotControls();
  }

  function paintOutputs(fresh) {
    for (const name of shownVars) {
      const td = $(`#var-out-${name}`);
      if (!td) continue;
      const v = outputs[name];
      const has = isFiniteNum(v);
      const text = has ? fmt(v) : '';
      if (fresh && has && td.textContent !== text) {
        td.classList.remove('fresh'); void td.offsetWidth; td.classList.add('fresh');
      }
      td.textContent = text;
      td.classList.toggle('has', has);
      const d = vdata(name);
      const row = $(`#var-row-${name}`);
      row.classList.toggle('is-guess', d.st === 'G');
    }
  }

  function onVarInput(name, col, input) {
    const d = vdata(name);
    if (col === 'st') {
      const v = input.value.toUpperCase();
      if (v !== '' && v !== 'G' && v !== 'L') { input.value = d.st; setStatus('Status can be blank, G (guess) or L (list).', 'err'); return; }
      input.value = v; d.st = v;
      paintOutputs(false); renderLists(); renderPlotControls();
    } else if (col === 'in') {
      d.input = input.value;
      if (input.value.trim() !== '' && d.st !== 'G') delete outputs[name];
    } else if (col === 'unit') d.unit = input.value;
    else if (col === 'com') d.comment = input.value;
    save();
    if (prefs.autoSolve && (col === 'in' || col === 'st' || col === 'unit')) solveNow(true);
  }

  function onGridKey(ev, scope, col, row, nRows, idFor) {
    let target = null;
    if (ev.key === 'ArrowDown' || ev.key === 'Enter') target = row + 1;
    else if (ev.key === 'ArrowUp') target = row - 1;
    if (target == null) return;
    if (target < 0 || target >= nRows) { if (ev.key === 'Enter') ev.preventDefault(); return; }
    ev.preventDefault();
    const el = document.querySelector(idFor(target, col));
    if (el) { el.focus(); el.select(); }
  }

  function moveOutputToInput(name) {
    const v = outputs[name];
    if (!isFiniteNum(v)) return;
    const d = vdata(name);
    d.input = fmt(v);
    if (d.st === 'L') d.st = '';
    delete outputs[name];
    const inp = $(`#var-in-${name}`); if (inp) inp.value = d.input;
    const st = $(`#var-st-${name}`); if (st) st.value = d.st;
    paintOutputs(false); save();
    setStatus(`${name} moved to Input. Clear another input and press ! to solve backwards.`, '');
  }

  // ------------------------------------------------------------------ solving

  function gatherInputs(excludeVars) {
    const U = units();
    const inputs = {}, guesses = {}, bad = [];
    for (const v of model.variables) {
      if (excludeVars && excludeVars.has(v)) continue;
      const d = vdata(v);
      if (d.input.trim() === '') continue;
      const x = E.evalConst(d.input);
      if (!Number.isFinite(x)) { bad.push(v); continue; }
      const c = U.toCalc(d.unit, x);
      if (d.st === 'G') guesses[v] = c; else inputs[v] = c;
    }
    return { inputs, guesses, bad, U };
  }

  function hintsFromOutputs(U) {
    const hints = {};
    for (const [k, v] of Object.entries(outputs)) if (isFiniteNum(v)) hints[k] = U.toCalc(vdata(k).unit, v);
    return hints;
  }

  function solveNow(quiet) {
    if (!quiet) flash('.bang');
    const { inputs, guesses, bad, U } = gatherInputs();
    if (bad.length) { setStatus(`Input for ${bad.join(', ')} is not a number.`, 'err'); return; }
    if (!model.rules.some((r) => r.ok)) { setStatus('Type a rule first, for example  c^2 = a^2 + b^2', 'err'); return; }
    const t0 = performance.now();
    const res = E.solve(model, inputs, guesses, { autoGuess: prefs.autoGuess, hints: hintsFromOutputs(U) });
    const ms = performance.now() - t0;
    outputs = {};
    for (const [k, v] of Object.entries(res.values)) {
      if (k in inputs) continue;
      outputs[k] = U.fromCalc(vdata(k).unit, v);
    }
    ruleStatus = res.ruleStatus;
    paintRuleStatus(); paintOutputs(true);
    const tags = [];
    if (res.autoGuessed.length) tags.push(`auto-guessed ${res.autoGuessed.join(', ')}`);
    if (ms > 30) tags.push(`${Math.round(ms)} ms`);
    setStatus(res.message, res.ok ? 'ok' : 'err', tags);
  }

  function listSolveNow() {
    flash(null);
    const lvars = model.variables.filter((v) => vdata(v).st === 'L');
    const inputLists = lvars.filter((v) => {
      const l = state.lists[v];
      return l && !l.computed && l.values.some((x) => Number.isFinite(E.evalConst(x)));
    });
    if (!inputLists.length) {
      setStatus('List Solve needs an input list: set a variable’s St to L, then enter values on the Lists tab.', 'err');
      selectTab('lists');
      return;
    }
    const { inputs, guesses, bad, U } = gatherInputs(new Set(inputLists));
    if (bad.length) { setStatus(`Input for ${bad.join(', ')} is not a number.`, 'err'); return; }
    const listInputs = {};
    for (const v of inputLists) listInputs[v] = state.lists[v].values.map((x) => { const n = E.evalConst(x); return Number.isFinite(n) ? U.toCalc(vdata(v).unit, n) : NaN; });
    const outLists = lvars.filter((v) => !inputLists.includes(v));
    for (const v of outLists) delete inputs[v];
    const rows = E.listSolve(model, inputs, guesses, listInputs, { autoGuess: prefs.autoGuess });
    let okRows = 0, total = 0, firstErr = '';
    for (const v of outLists) state.lists[v] = { values: [], computed: true };
    rows.forEach((r, i) => {
      if (!r) { outLists.forEach((v) => { state.lists[v].values[i] = ''; }); return; }
      total++;
      if (r.ok) okRows++; else if (!firstErr) firstErr = `row ${i + 1}: ${r.message}`;
      for (const v of outLists) {
        const x = r.ok ? r.values[v] : NaN;
        state.lists[v].values[i] = Number.isFinite(x) ? E.formatNumber(U.fromCalc(vdata(v).unit, x), 10) : '';
      }
    });
    // The Variable Sheet keeps showing the answer for the current inputs.
    solveNow(true);
    if (!state.plot.x || !lvars.includes(state.plot.x)) state.plot.x = inputLists[0];
    if (!state.plot.y.some((y) => outLists.includes(y))) state.plot.y = outLists.slice(0, 3);
    save();
    renderLists(); renderPlotControls(); drawPlot();
    if (prefs.tab !== 'lists') selectTab('plot');
    const msg = `List Solve: ${okRows} of ${total} rows solved` + (outLists.length ? ` → ${outLists.join(', ')}` : ' (no output lists — set St to L on the variables you want to collect)');
    setStatus(okRows === total ? msg : `${msg}. First problem, ${firstErr}`, okRows === total && outLists.length ? 'ok' : 'err');
  }

  function flash(sel) {
    if (!sel) return;
    document.querySelectorAll(sel).forEach((b) => { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 120); });
  }

  // ------------------------------------------------------------------ lists

  function listNames() {
    const names = model.variables.filter((v) => vdata(v).st === 'L');
    return names;
  }

  function renderLists() {
    const names = listNames();
    const table = $('#list-table');
    table.textContent = '';
    const fillSel = $('#fill-list');
    const prevFill = fillSel.value;
    fillSel.textContent = '';
    names.forEach((n) => fillSel.append(h('option', { value: n, text: n })));
    if (names.includes(prevFill)) fillSel.value = prevFill;
    if (!names.length) {
      table.append(h('tbody', {}, h('tr', { class: 'empty' }, h('td', { text: 'No lists yet. Set a variable’s St to L.' }))));
      return;
    }
    for (const n of names) if (!state.lists[n]) state.lists[n] = { values: [], computed: false };
    const len = Math.max(...names.map((n) => state.lists[n].values.length)) + 1;
    const head = h('tr', {}, h('th', { text: '#' }), names.map((n) => {
      const l = state.lists[n];
      return h('th', {}, n, h('small', { text: l.computed ? 'out' : (l.values.some((x) => x !== '') ? 'in' : '') }),
        h('button', { class: 'clear-list', type: 'button', title: `Clear list ${n}`, 'aria-label': `Clear list ${n}`, onclick: () => { state.lists[n] = { values: [], computed: false }; save(); renderLists(); drawPlot(); } }, '×'));
    }));
    const body = h('tbody', {});
    for (let i = 0; i < len; i++) {
      body.append(h('tr', {}, h('td', { class: 'idx', text: i + 1 }), names.map((n, c) => {
        const l = state.lists[n];
        const input = h('input', { id: `list-${n}-${i}`, value: l.values[i] || '', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${n} row ${i + 1}` });
        input.addEventListener('change', () => {
          const L = state.lists[n];
          L.values[i] = input.value.trim();
          L.computed = false;
          while (L.values.length && L.values[L.values.length - 1] === '') L.values.pop();
          save(); renderLists(); drawPlot();
          const next = $(`#list-${n}-${i + 1}`); if (next) next.focus();
        });
        input.addEventListener('keydown', (ev) => onGridKey(ev, '#list-table', c, i, len, (r) => `#list-${n}-${r}`));
        return h('td', { class: l.computed ? 'computed' : '' }, input);
      })));
    }
    table.append(h('thead', {}, head), body);
  }

  function onFill(ev) {
    ev.preventDefault();
    const n = $('#fill-list').value;
    const a = E.evalConst($('#fill-from').value), b = E.evalConst($('#fill-to').value);
    const steps = Math.round(E.evalConst($('#fill-n').value));
    if (!n) { setStatus('Set a variable’s St to L first, then fill its list.', 'err'); return; }
    if (![a, b].every(Number.isFinite) || !(steps >= 1 && steps <= 10000)) { setStatus('Fill needs numbers for from and to, and 1 to 10000 steps.', 'err'); return; }
    const values = [];
    for (let i = 0; i <= steps; i++) values.push(E.formatNumber(a + (b - a) * i / steps, 10));
    state.lists[n] = { values, computed: false };
    save(); renderLists(); drawPlot();
    setStatus(`List ${n} filled with ${values.length} values. Choose List Solve to compute the others.`, 'ok');
  }

  // ------------------------------------------------------------------ plot

  function renderPlotControls() {
    const names = listNames();
    const sx = $('#plot-x');
    sx.textContent = '';
    names.forEach((n) => sx.append(h('option', { value: n, text: n })));
    if (!names.includes(state.plot.x)) state.plot.x = names[0] || '';
    sx.value = state.plot.x;
    const py = $('#plot-y');
    py.textContent = '';
    names.filter((n) => n !== state.plot.x).forEach((n) => {
      const cb = h('input', { type: 'checkbox', id: `plot-y-${n}`, value: n });
      cb.checked = state.plot.y.includes(n);
      cb.addEventListener('change', () => {
        state.plot.y = names.filter((m) => m !== state.plot.x && ($(`#plot-y-${m}`) || {}).checked);
        save(); drawPlot();
      });
      py.append(h('label', { for: `plot-y-${n}` }, cb, n));
    });
    drawPlot();
  }

  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    const span = hi - lo;
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = start; t <= end + step * 1e-9; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
    return { lo: start, hi: end, ticks, step };
  }

  function drawPlot() {
    const canvas = $('#plot-canvas');
    if (!canvas || $('#pane-plot').hidden) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(200, rect.width), H = Math.max(150, rect.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--ink').trim() || '#000';
    const paper = cs.getPropertyValue('--paper').trim() || '#fff';
    const dim = cs.getPropertyValue('--gray').trim() || '#808080';
    const dataFont = cs.getPropertyValue('--font').trim();
    const u = parseFloat(cs.getPropertyValue('--u')) || 1;
    ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);

    const note = $('#plot-note');
    document.querySelector('.plot-controls').hidden = listNames().length === 0;
    const xName = state.plot.x;
    const series = state.plot.y.filter((y) => y !== xName && state.lists[y]);
    const toNum = (s) => { const n = E.evalConst(s); return Number.isFinite(n) ? n : NaN; };
    const X = xName && state.lists[xName] ? state.lists[xName].values.map(toNum) : [];
    const data = series.map((name) => ({ name, pts: (state.lists[name].values || []).map((s, i) => [X[i], toNum(s)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)) }))
      .filter((s) => s.pts.length);

    ctx.font = `${12 * u}px ${dataFont}`;
    if (!data.length) {
      ctx.fillStyle = dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(listNames().length ? 'Choose List Solve to fill the lists, then pick a Y series.' : 'No lists to plot yet.', W / 2, H / 2);
      note.textContent = 'Try File → Projectile Range for a ready-made list solve.';
      return;
    }
    note.textContent = `${data.reduce((s, d) => s + d.pts.length, 0)} points · ${data.map((d) => d.name).join(', ')} vs ${xName}`;

    const allX = data.flatMap((d) => d.pts.map((p) => p[0]));
    const allY = data.flatMap((d) => d.pts.map((p) => p[1]));
    const tx = niceTicks(Math.min(...allX), Math.max(...allX), Math.max(3, Math.floor(W / (90 * u))));
    const ty = niceTicks(Math.min(0, Math.min(...allY)) === 0 && Math.min(...allY) >= 0 && Math.min(...allY) < Math.max(...allY) * 0.25 ? 0 : Math.min(...allY), Math.max(...allY), Math.max(3, Math.floor(H / (50 * u))));
    const yLabels = ty.ticks.map((t) => fmtTick(t, ty.step));
    const padL = 10 * u + Math.max(...yLabels.map((s) => ctx.measureText(s).width)), padR = 12 * u, padT = 26 * u, padB = 36 * u;
    const px = (x) => padL + (x - tx.lo) / (tx.hi - tx.lo) * (W - padL - padR);
    const py = (y) => H - padB - (y - ty.lo) / (ty.hi - ty.lo) * (H - padT - padB);

    // grid + ticks
    ctx.strokeStyle = ink; ctx.lineWidth = u; ctx.setLineDash([u, 2 * u]);
    ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ty.ticks.forEach((t, i) => {
      const y = Math.round(py(t)) + u / 2;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(yLabels[i], padL - 5 * u, y);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    tx.ticks.forEach((t) => {
      const x = Math.round(px(t)) + u / 2;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.fillText(fmtTick(t, tx.step), x, H - padB + 5 * u);
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = ink; ctx.lineWidth = u; ctx.strokeRect(Math.round(padL) + u / 2, padT + u / 2, Math.round(W - padL - padR), Math.round(H - padT - padB));
    const xUnit = vdata(xName).unit;
    ctx.fillText(xName + (xUnit ? ` (${xUnit})` : ''), (padL + W - padR) / 2, H - 15 * u);

    // series: 1-bit styles — solid/squares, dashed/circles, dotted/triangles
    const styles = [[[], 'square'], [[6 * u, 4 * u], 'circle'], [[2 * u, 2 * u], 'triangle'], [[10 * u, 3 * u, 2 * u, 3 * u], 'diamond']];
    data.forEach((s, k) => {
      const [dash, marker] = styles[k % styles.length];
      const pts = s.pts.slice().sort((a, b) => a[0] - b[0]);
      ctx.strokeStyle = ink; ctx.lineWidth = u; ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
      ctx.stroke(); ctx.setLineDash([]);
      if (pts.length <= 60) pts.forEach(([x, y]) => drawMarker(ctx, marker, px(x), py(y), ink, paper, k === 0, u));
      // legend
      const lx = padL + 8 * u + k * 130 * u, ly = 12 * u;
      ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 28 * u, ly); ctx.stroke(); ctx.setLineDash([]);
      drawMarker(ctx, marker, lx + 14 * u, ly, ink, paper, k === 0, u);
      ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const unit = vdata(s.name).unit;
      ctx.fillText(s.name + (unit ? ` (${unit})` : ''), lx + 34 * u, ly);
    });
  }

  function drawMarker(ctx, kind, x, y, ink, paper, filled, u) {
    const r = 3 * u;
    ctx.beginPath();
    if (kind === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else if (kind === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (kind === 'triangle') { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y + r); ctx.lineTo(x - r - 1, y + r); ctx.closePath(); }
    else { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath(); }
    ctx.fillStyle = filled ? ink : paper; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = u; ctx.stroke();
  }

  function fmtTick(t, step) {
    if (Math.abs(t) >= 1e6 || (Math.abs(t) < 1e-3 && t !== 0)) return E.formatNumber(t, 3);
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return t.toFixed(Math.min(dec, 6));
  }

  // ------------------------------------------------------------------ units sheet

  function renderUnits() {
    const body = $('#unit-body');
    body.textContent = '';
    const rows = state.units.concat([{ from: '', to: '', factor: '', offset: '' }]);
    const cols = ['from', 'to', 'factor', 'offset'];
    rows.forEach((u, i) => {
      body.append(h('tr', {}, cols.map((c, ci) => {
        const input = h('input', {
          id: `unit-${c}-${i}`, value: u[c] || '', autocomplete: 'off', spellcheck: 'false',
          placeholder: i === rows.length - 1 ? ({ from: 'e.g. ft', to: 'm', factor: '0.3048', offset: '0' })[c] : '',
          'aria-label': `Unit row ${i + 1} ${c}`,
        });
        input.addEventListener('change', () => {
          if (i === state.units.length) state.units.push({ from: '', to: '', factor: '', offset: '' });
          state.units[i][c] = input.value.trim();
          state.units = state.units.filter((r) => r.from || r.to || r.factor || r.offset);
          save(); renderUnits();
          const next = $(`#unit-${cols[ci + 1] || 'from'}-${ci === 3 ? i + 1 : i}`); if (next) next.focus();
        });
        input.addEventListener('keydown', (ev) => onGridKey(ev, '#unit-body', c, i, rows.length, (r, cc) => `#unit-${cc}-${r}`));
        return h('td', {}, input);
      })));
    });
  }

  // ------------------------------------------------------------------ tabs, menus, dialogs

  function selectTab(tab) {
    prefs.tab = tab; savePrefs();
    document.querySelectorAll('#tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    $('#sub-title').textContent = ({ plot: 'Plot Sheet', lists: 'List Sheet', units: 'Units Sheet', guide: 'Quick Guide' })[tab];
    if (tab === 'plot') drawPlot();
  }

  function closeMenus() {
    document.querySelectorAll('.menu.open').forEach((m) => { m.classList.remove('open'); m.querySelector('.menu-title').setAttribute('aria-expanded', 'false'); });
  }
  function setupMenus() {
    const panel = $('#examples-panel');
    EXAMPLES.filter((ex) => ex.id !== 'blank').forEach((ex) => panel.append(h('button', { role: 'menuitem', 'data-cmd': `example:${ex.id}`, title: ex.desc }, ex.title)));
    document.querySelectorAll('.menu').forEach((menu) => {
      const title = menu.querySelector('.menu-title');
      title.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const open = menu.classList.contains('open');
        closeMenus();
        if (!open) { menu.classList.add('open'); title.setAttribute('aria-expanded', 'true'); }
      });
      title.addEventListener('mouseenter', () => {
        if (document.querySelector('.menu.open') && !menu.classList.contains('open')) { closeMenus(); menu.classList.add('open'); title.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('click', (ev) => {
      const item = ev.target.closest('[data-cmd]');
      if (item) { closeMenus(); command(item.dataset.cmd); return; }
      if (!ev.target.closest('.menu')) closeMenus();
    });
    paintOptions();
  }
  function paintOptions() {
    $('#opt-autoguess').setAttribute('aria-checked', String(!!prefs.autoGuess));
    $('#opt-autosolve').setAttribute('aria-checked', String(!!prefs.autoSolve));
    const u = pixelScale();
    $('#opt-size-1').setAttribute('aria-checked', String(u === 1));
    $('#opt-size-2').setAttribute('aria-checked', String(u === 2));
  }

  // Screen-pixel scale: 1 = Chicago 12 at 12 px, 2 = every Mac pixel doubled.
  // Until the viewer picks one, use double size on big screens.
  function pixelScale() {
    if (prefs.size === 1 || prefs.size === 2) return prefs.size;
    return window.innerWidth >= 1700 ? 2 : 1;
  }
  function applyScale() {
    const u = pixelScale();
    document.documentElement.classList.toggle('double', u === 2);
    // Two columns only when both windows fit at this scale.
    document.querySelector('.columns').classList.toggle('wide', window.innerWidth >= 960 * u);
  }

  function dialog(title, body, actions) {
    $('#dialog-title').textContent = title;
    const b = $('#dialog-body'); b.textContent = ''; b.append(...[].concat(body));
    const a = $('#dialog-actions'); a.textContent = '';
    (actions || [{ label: 'OK', default: true }]).forEach((act) => {
      a.append(h('button', { class: act.default ? 'btn default' : 'btn', type: 'button', onclick: () => { if (act.run && act.run() === false) return; closeDialog(); } }, act.label));
    });
    $('#dialog').hidden = false;
    const first = b.querySelector('textarea') || a.querySelector('.default');
    if (first) first.focus();
  }
  function closeDialog() { $('#dialog').hidden = true; }

  function about() {
    dialog('About MK!Solver', [
      h('div', { class: 'about-logo', text: 'MK!Solver' }),
      h('p', {}, 'A declarative equation solver for the browser, after TK!Solver (Software Arts, 1982), the program that let engineers type equations in any order and solve them for whatever was unknown.'),
      h('p', {}, 'Direct solver by consecutive substitution with symbolic inversion; iterative solver by damped Newton–Raphson (Levenberg–Marquardt) on guessed variables; list solving, units and plots.'),
      h('p', {}, 'Everything runs locally in your browser. Your model is kept in this browser’s storage.'),
    ]);
  }

  function modelText() {
    const copy = JSON.parse(JSON.stringify(state));
    copy.rules = copy.rules.filter((r, i) => r.trim() !== '' || i < copy.rules.length - 1);
    // Drop data for variables no longer in any rule.
    for (const k of Object.keys(copy.vars)) if (!model.variables.includes(k)) delete copy.vars[k];
    for (const k of Object.keys(copy.lists)) if (!model.variables.includes(k)) delete copy.lists[k];
    return JSON.stringify(Object.assign({ format: 'MK!Solver model', version: 1 }, copy), null, 2);
  }

  function textDialog() {
    const ta = h('textarea', { id: 'model-text', spellcheck: 'false', 'aria-label': 'Model as JSON text' });
    ta.value = modelText();
    dialog('Model as Text', [h('p', {}, 'Copy this text to keep or share the model, or paste a model here and choose Load.'), ta], [
      { label: 'Copy', run: () => {
        const done = () => setStatus('Model copied to the clipboard.', 'ok');
        try {
          navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); setStatus('Select-all is done; press Ctrl+C to copy.', ''); });
        } catch (_) { ta.select(); }
        return false;
      } },
      { label: 'Cancel' },
      { label: 'Load', default: true, run: () => {
        try { loadState(JSON.parse(ta.value)); setStatus(`Loaded “${state.title}”.`, 'ok'); } catch (e) { setStatus(`That text is not a valid model: ${e.message}`, 'err'); return false; }
      } },
    ]);
  }

  function downloadModel() {
    try {
      const blob = new Blob([modelText()], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${(state.title || 'model').replace(/[^\w\- ]+/g, '').trim() || 'model'}.mks` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setStatus('Saved. If no file appeared, use File → Model as Text… and copy it.', 'ok');
    } catch (_) {
      textDialog();
    }
  }

  function loadState(s, opts) {
    state = normalizeState(s);
    outputs = {};
    rebuildModel();
    shownVars = [];
    renderRules();
    renderVariables();
    renderUnits();
    renderLists();
    renderPlotControls();
    paintTitle();
    save();
    if (opts && opts.solve) solveNow(true);
  }

  function loadExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    loadState({ title: ex.title, rules: ex.rules, vars: ex.vars, units: ex.units || [], lists: ex.lists || {}, plot: ex.plot || { x: '', y: [] } });
    if (ex.solveList) { solveNow(true); listSolveNow(); }
    else if (id !== 'blank') solveNow(true);
    else setStatus('Blank model. Type a rule, for example  F = m * a', '');
    if (ex.lists) selectTab('plot');
    const first = $('#rule-0'); if (first && id === 'blank') first.focus();
  }

  function paintTitle() {
    const t = state.title && state.title !== 'Untitled' ? `MK!Solver \u2014 ${state.title}` : 'MK!Solver';
    $('#window-title').textContent = t;
    document.title = state.title && state.title !== 'Untitled' ? `MK!Solver: ${state.title}` : 'MK!Solver';
  }

  // TK-style prompt line: "(row) Column:" for the cell being edited.
  function paintPrompt(el) {
    if (!el || !el.id) return;
    let m;
    if ((m = /^rule-(\d+)$/.exec(el.id))) return setPrompt(`(${+m[1] + 1}) Rule:`);
    if ((m = /^var-(st|in|unit|com)-(.+)$/.exec(el.id))) {
      const row = shownVars.indexOf(m[2]) + 1;
      return setPrompt(`(${row}) ${({ st: 'Status', in: 'Input', unit: 'Unit', com: 'Comment' })[m[1]]}: ${m[2]}`);
    }
    if ((m = /^list-(.+)-(\d+)$/.exec(el.id))) return setPrompt(`(${+m[2] + 1}) List: ${m[1]}`);
    if ((m = /^unit-(\w+)-(\d+)$/.exec(el.id))) return setPrompt(`(${+m[2] + 1}) Unit: ${m[1]}`);
  }
  function setPrompt(text) { $('#prompt-cell').textContent = text; }

  function command(cmd) {
    if (cmd.startsWith('example:')) return loadExample(cmd.slice(8));
    if (cmd.startsWith('tab:')) return selectTab(cmd.slice(4));
    if (cmd === 'focus:vars') { const el = document.querySelector('#var-body input[data-col="in"]'); if (el) el.focus(); return; }
    if (cmd === 'focus:rules') { const el = $('#rule-0'); if (el) el.focus(); return; }
    switch (cmd) {
      case 'about': return about();
      case 'guide': return selectTab('guide');
      case 'new': return loadExample('blank');
      case 'open': return $('#file-input').click();
      case 'save': return downloadModel();
      case 'text': return textDialog();
      case 'solve': return solveNow();
      case 'list-solve': return listSolveNow();
      case 'clear-outputs':
        outputs = {}; ruleStatus = model.rules.map((r) => (r.blank ? 'blank' : r.ok ? '' : 'error'));
        paintOutputs(false); paintRuleStatus(); setStatus('Outputs cleared.', ''); return;
      case 'clear-inputs':
        for (const v of model.variables) { vdata(v).input = ''; }
        outputs = {}; renderVariables(); save(); setStatus('Inputs cleared.', ''); return;
      case 'outputs-to-guesses': {
        const moved = [];
        for (const v of model.variables) {
          const d = vdata(v);
          if (isFiniteNum(outputs[v]) && d.input.trim() === '') { d.input = fmt(outputs[v]); d.st = 'G'; moved.push(v); }
        }
        renderVariables(); save();
        setStatus(moved.length ? `Outputs saved as guesses: ${moved.join(', ')}` : 'No outputs to copy.', moved.length ? 'ok' : '');
        return;
      }
      case 'toggle-autoguess': prefs.autoGuess = !prefs.autoGuess; savePrefs(); paintOptions();
        return setStatus(prefs.autoGuess ? 'Auto-guess on: MK!Solver picks guess variables when you have not.' : 'Auto-guess off: mark guesses yourself with St = G, as in TK!Solver.', '');
      case 'size:1': case 'size:2':
        prefs.size = Number(cmd.slice(5)); savePrefs(); applyScale(); paintOptions(); drawPlot(); return;
      case 'toggle-autosolve': prefs.autoSolve = !prefs.autoSolve; savePrefs(); paintOptions();
        if (prefs.autoSolve) solveNow(true); return;
    }
  }

  // ------------------------------------------------------------------ boot

  function init() {
    setupMenus();
    document.addEventListener('focusin', (ev) => paintPrompt(ev.target));
    $('#fill-form').addEventListener('submit', onFill);
    $('#plot-x').addEventListener('change', (ev) => { state.plot.x = ev.target.value; state.plot.y = state.plot.y.filter((y) => y !== state.plot.x); save(); renderPlotControls(); });
    document.querySelectorAll('#tabs [role=tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
    $('#dialog').addEventListener('click', (ev) => { if (ev.target.id === 'dialog') closeDialog(); });
    $('#file-input').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { loadState(JSON.parse(reader.result), { solve: true }); setStatus(`Opened ${f.name}.`, 'ok'); } catch (e) { setStatus(`${f.name} is not a MK!Solver model (${e.message}).`, 'err'); }
      };
      reader.readAsText(f);
      ev.target.value = '';
    });
    $('#window-title').addEventListener('dblclick', () => {
      const ta = h('input', { id: 'title-edit', value: state.title, 'aria-label': 'Model name', style: 'width:100%;padding:0.3rem;border:1px solid currentColor;background:transparent' });
      dialog('Rename Model', [ta], [{ label: 'Cancel' }, { label: 'Rename', default: true, run: () => { state.title = ta.value.trim() || 'Untitled'; paintTitle(); save(); } }]);
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { closeMenus(); closeDialog(); return; }
      if (!$('#dialog').hidden) return;
      if (ev.key === 'F9') { ev.preventDefault(); return ev.shiftKey ? listSolveNow() : solveNow(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); return solveNow(); }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) { ev.preventDefault(); return downloadModel(); }
      if (ev.key === '!') {
        // "!" is the solve key, as in TK!Solver. Let it through in comment / unit / text fields.
        const t = ev.target;
        const textish = t && t.matches && t.matches('input, textarea') && !(t.id.startsWith('rule-') || /^var-(in|st)-/.test(t.id) || t.id.startsWith('list-'));
        if (!textish) { ev.preventDefault(); solveNow(); }
      }
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawPlot);
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { applyScale(); paintOptions(); drawPlot(); }, 80); });

    const saved = loadSaved();
    applyScale(); paintOptions();
    selectTab(prefs.tab || 'plot');
    if (saved && saved.rules.some((r) => r.trim())) {
      loadState(saved, { solve: true });
      if (state.title) setStatus(`Welcome back — “${state.title}” restored. Press ! to solve.`, '');
    } else {
      loadExample('triangle');
      setStatus('Example loaded: Right Triangle. Change an input and press ! — more examples are in the File menu.', 'ok');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
