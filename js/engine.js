/*
 * CH!Solver engine
 * ----------------
 * A declarative equation solver in the spirit of TK!Solver (Software Arts, 1982;
 * Macintosh edition 1984-85). Rules are equations, not assignments: any rule can
 * be solved for any one of its variables.
 *
 *   1. Parser          rule text -> AST -> compiled closures
 *   2. Direct solver   repeatedly find a rule with exactly one unknown and solve
 *                      it for that unknown (symbolic inversion first, numeric 1-D
 *                      root finding as a fallback).
 *   3. Iterative solver  when the direct solver stalls, guessed variables are
 *                      treated as provisionally known, the direct solver is run
 *                      again, and the rules left over (fully known but unused)
 *                      become residuals. Levenberg-Marquardt (damped Newton)
 *                      adjusts the guesses until every residual is zero.
 *   4. List solver     re-solve the model once per element of input lists.
 *   5. Units           display unit <-> calculation unit conversions.
 *
 * Works in the browser (window.CHEngine) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CHEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ parser

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      // TK-style comment: a double quote starts a comment to end of line.
      if (c === '"' || c === ';' || (c === '/' && src[i + 1] === '/')) break;
      if ((c >= '0' && c <= '9') || c === '.') {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        if (!m) throw new SyntaxError(`bad number at column ${i + 1}`);
        toks.push({ type: 'num', value: parseFloat(m[0]), pos: i });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        toks.push({ type: 'id', value: m[0], pos: i });
        i += m[0].length;
        continue;
      }
      if (c === '*' && src[i + 1] === '*') { toks.push({ type: 'op', value: '^', pos: i }); i += 2; continue; }
      if ('+-*/^(),='.includes(c)) { toks.push({ type: 'op', value: c, pos: i }); i++; continue; }
      throw new SyntaxError(`unexpected '${c}' at column ${i + 1}`);
    }
    toks.push({ type: 'eof', pos: i });
    return toks;
  }

  const FUNCS = {
    sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
    asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan],
    atan2: [2, Math.atan2],
    sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh],
    asinh: [1, Math.asinh], acosh: [1, Math.acosh], atanh: [1, Math.atanh],
    sqrt: [1, Math.sqrt], exp: [1, Math.exp], ln: [1, Math.log],
    log: [1, Math.log10], log10: [1, Math.log10],
    abs: [1, Math.abs], sgn: [1, Math.sign], sign: [1, Math.sign],
    int: [1, Math.trunc], floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round],
    mod: [2, (a, b) => a - b * Math.floor(a / b)],
    min: [-1, Math.min], max: [-1, Math.max],
    deg: [1, (r) => r * 180 / Math.PI], rad: [1, (d) => d * Math.PI / 180],
    pi: [0, () => Math.PI],
  };
  const CONSTANTS = { pi: Math.PI };

  function parseExpression(toks, state) {
    const peek = () => toks[state.i];
    const next = () => toks[state.i++];
    const isOp = (v) => peek().type === 'op' && peek().value === v;
    const expect = (v) => {
      if (!isOp(v)) throw new SyntaxError(`expected '${v}' at column ${peek().pos + 1}`);
      next();
    };

    function add() {
      let a = mul();
      while (isOp('+') || isOp('-')) {
        const op = next().value;
        a = { t: 'bin', op, a, b: mul() };
      }
      return a;
    }
    function mul() {
      let a = unary();
      while (isOp('*') || isOp('/')) {
        const op = next().value;
        a = { t: 'bin', op, a, b: unary() };
      }
      return a;
    }
    function unary() {
      if (isOp('-')) { next(); return { t: 'neg', a: unary() }; }
      if (isOp('+')) { next(); return unary(); }
      return pow();
    }
    function pow() {
      const base = primary();
      if (isOp('^')) { next(); return { t: 'bin', op: '^', a: base, b: unary() }; }
      return base;
    }
    function primary() {
      const tk = peek();
      if (tk.type === 'num') { next(); return { t: 'num', v: tk.value }; }
      if (tk.type === 'id') {
        next();
        if (isOp('(')) {
          const name = tk.value.toLowerCase();
          const fn = FUNCS[name];
          if (!fn) throw new SyntaxError(`unknown function '${tk.value}'`);
          next();
          const args = [];
          if (!isOp(')')) {
            args.push(add());
            while (isOp(',')) { next(); args.push(add()); }
          }
          expect(')');
          if (fn[0] >= 0 && args.length !== fn[0]) {
            throw new SyntaxError(`${name}() takes ${fn[0]} argument${fn[0] === 1 ? '' : 's'}`);
          }
          if (fn[0] < 0 && args.length === 0) throw new SyntaxError(`${name}() needs arguments`);
          return { t: 'call', f: name, args };
        }
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, tk.value)) return { t: 'num', v: CONSTANTS[tk.value], name: tk.value };
        return { t: 'var', n: tk.value };
      }
      if (tk.type === 'op' && tk.value === '(') {
        next();
        const e = add();
        expect(')');
        return e;
      }
      if (tk.type === 'eof') throw new SyntaxError('unexpected end of rule');
      throw new SyntaxError(`unexpected '${tk.value}' at column ${tk.pos + 1}`);
    }
    return add();
  }

  /** Parse one rule line. Returns null for blank / comment-only lines. */
  function parseRule(src) {
    const toks = tokenize(src);
    if (toks[0].type === 'eof') return null;
    const state = { i: 0 };
    const lhs = parseExpression(toks, state);
    const tk = toks[state.i];
    if (!(tk.type === 'op' && tk.value === '=')) {
      if (tk.type === 'eof') throw new SyntaxError("a rule needs an '=' sign");
      throw new SyntaxError(`unexpected '${tk.value}' at column ${tk.pos + 1}`);
    }
    state.i++;
    const rhs = parseExpression(toks, state);
    const end = toks[state.i];
    if (end.type !== 'eof') {
      if (end.type === 'op' && end.value === '=') throw new SyntaxError("only one '=' allowed per rule");
      throw new SyntaxError(`unexpected '${end.value}' at column ${end.pos + 1}`);
    }
    return { lhs, rhs };
  }

  /** Parse a stand-alone expression (used for Input cells: "2*pi", "1e-3"). */
  function parseExpr(src) {
    const toks = tokenize(src);
    if (toks[0].type === 'eof') return null;
    const state = { i: 0 };
    const e = parseExpression(toks, state);
    if (toks[state.i].type !== 'eof') throw new SyntaxError(`unexpected '${toks[state.i].value}'`);
    return e;
  }

  function collectVars(node, out) {
    switch (node.t) {
      case 'var': if (!out.includes(node.n)) out.push(node.n); break;
      case 'neg': collectVars(node.a, out); break;
      case 'bin': collectVars(node.a, out); collectVars(node.b, out); break;
      case 'call': node.args.forEach((a) => collectVars(a, out)); break;
    }
    return out;
  }

  function countVar(node, v) {
    switch (node.t) {
      case 'var': return node.n === v ? 1 : 0;
      case 'neg': return countVar(node.a, v);
      case 'bin': return countVar(node.a, v) + countVar(node.b, v);
      case 'call': return node.args.reduce((s, a) => s + countVar(a, v), 0);
      default: return 0;
    }
  }

  function compile(node) {
    switch (node.t) {
      case 'num': { const v = node.v; return () => v; }
      case 'var': { const n = node.n; return (env) => env[n]; }
      case 'neg': { const a = compile(node.a); return (env) => -a(env); }
      case 'bin': {
        const a = compile(node.a), b = compile(node.b);
        switch (node.op) {
          case '+': return (env) => a(env) + b(env);
          case '-': return (env) => a(env) - b(env);
          case '*': return (env) => a(env) * b(env);
          case '/': return (env) => a(env) / b(env);
          case '^': return (env) => Math.pow(a(env), b(env));
        }
        break;
      }
      case 'call': {
        const fn = FUNCS[node.f][1];
        const args = node.args.map(compile);
        if (args.length === 0) return () => fn();
        if (args.length === 1) { const a = args[0]; return (env) => fn(a(env)); }
        if (args.length === 2) { const a = args[0], b = args[1]; return (env) => fn(a(env), b(env)); }
        return (env) => fn(...args.map((f) => f(env)));
      }
    }
    throw new Error('compile: bad node');
  }

  function toText(node) {
    switch (node.t) {
      case 'num': return node.name || String(node.v);
      case 'var': return node.n;
      case 'neg': return `-${wrap(node.a)}`;
      case 'bin': return `${wrap(node.a)} ${node.op} ${wrap(node.b)}`;
      case 'call': return `${node.f}(${node.args.map(toText).join(', ')})`;
    }
    function wrap(n) { return n.t === 'bin' ? `(${toText(n)})` : toText(n); }
  }

  /** Evaluate a constant expression such as "2*pi" or "1.5e3". NaN if invalid. */
  function evalConst(src) {
    if (src == null) return NaN;
    const s = String(src).trim();
    if (s === '') return NaN;
    try {
      const e = parseExpr(s);
      if (!e || collectVars(e, []).length) return NaN;
      return compile(e)({});
    } catch (_) {
      return NaN;
    }
  }

  // ------------------------------------------------------------------ model

  /**
   * Build a model from rule source lines.
   * Returns { rules: [...], variables: [names in order of first appearance] }.
   * Each rule: { index, src, ok, error, vars, lhs, rhs, L, R }.
   */
  function buildModel(lines) {
    const variables = [];
    const rules = lines.map((src, index) => {
      const rule = { index, src, ok: false, blank: false, error: null, vars: [] };
      try {
        const p = parseRule(src);
        if (!p) { rule.blank = true; return rule; }
        rule.lhs = p.lhs; rule.rhs = p.rhs;
        rule.L = compile(p.lhs); rule.R = compile(p.rhs);
        rule.vars = collectVars(p.rhs, collectVars(p.lhs, []));
        rule.ok = true;
        rule.vars.forEach((v) => { if (!variables.includes(v)) variables.push(v); });
      } catch (e) {
        rule.error = e.message;
      }
      return rule;
    });
    return { rules, variables };
  }

  // ------------------------------------------------------------ 1-D solving

  const TOL = 1e-11;      // scaled residual accepted as "satisfied"
  const CHECK_TOL = 1e-6; // looser tolerance for reporting consistency

  function scaledResidual(rule, env) {
    const l = rule.L(env), r = rule.R(env);
    const d = l - r;
    if (!Number.isFinite(d)) {
      // Exact infinities on both sides (rare) count as equal.
      return l === r ? 0 : NaN;
    }
    return d / Math.max(1, Math.abs(l), Math.abs(r));
  }

  /**
   * Symbolically isolate variable v (which occurs exactly once in node) so that
   * node == target. Returns a number, or undefined when an operation along the
   * path is not invertible (then we fall back to numeric root finding).
   */
  function isolate(node, v, target, env, hint) {
    const has = (n) => countVar(n, v) > 0;
    const val = (n) => compile(n)(env);
    switch (node.t) {
      case 'var': return target;
      case 'neg': return isolate(node.a, v, -target, env, hint);
      case 'bin': {
        const inA = has(node.a);
        const other = val(inA ? node.b : node.a);
        switch (node.op) {
          case '+': return isolate(inA ? node.a : node.b, v, target - other, env, hint);
          case '-': return inA ? isolate(node.a, v, target + other, env, hint)
                               : isolate(node.b, v, other - target, env, hint);
          case '*': if (other === 0) return undefined;
                    return isolate(inA ? node.a : node.b, v, target / other, env, hint);
          case '/': if (inA) return isolate(node.a, v, target * other, env, hint);
                    if (target === 0) return undefined;
                    return isolate(node.b, v, other / target, env, hint);
          case '^': {
            if (inA) {
              const p = other;
              if (p === 0) return undefined;
              let root;
              const isInt = Number.isInteger(p);
              if (target < 0 && isInt && Math.abs(p) % 2 === 1) root = -Math.pow(-target, 1 / p);
              else root = Math.pow(target, 1 / p);
              // Even powers have two real roots (+/-). Without a hint take the
              // positive one; with a hint (guess or last answer) take the closer.
              if (isInt && p % 2 === 0 && Number.isFinite(root) && hint !== undefined) {
                const r1 = isolate(node.a, v, root, env, hint);
                const r2 = isolate(node.a, v, -root, env, hint);
                if (r1 === undefined || !Number.isFinite(r1)) return r2;
                if (r2 === undefined || !Number.isFinite(r2)) return r1;
                return Math.abs(r1 - hint) <= Math.abs(r2 - hint) ? r1 : r2;
              }
              return isolate(node.a, v, root, env, hint);
            }
            const base = other;
            if (base <= 0 || base === 1 || target <= 0) return undefined;
            return isolate(node.b, v, Math.log(target) / Math.log(base), env, hint);
          }
        }
        return undefined;
      }
      case 'call': {
        if (node.args.length !== 1) return undefined;
        const inv = {
          sin: Math.asin, cos: Math.acos, tan: Math.atan,
          asin: Math.sin, acos: Math.cos, atan: Math.tan,
          sinh: Math.asinh, asinh: Math.sinh, cosh: Math.acosh, acosh: Math.cosh,
          tanh: Math.atanh, atanh: Math.tanh,
          exp: Math.log, ln: Math.exp, log: (t) => Math.pow(10, t), log10: (t) => Math.pow(10, t),
          sqrt: (t) => (t >= 0 ? t * t : NaN),
          deg: (t) => t * Math.PI / 180, rad: (t) => t * 180 / Math.PI,
        }[node.f];
        if (!inv) return undefined;
        return isolate(node.args[0], v, inv(target), env, hint);
      }
    }
    return undefined;
  }

  function newton1D(g, x0, accept) {
    let x = x0;
    let fx = g(x);
    if (!Number.isFinite(fx)) return null;
    for (let it = 0; it < 100; it++) {
      if (accept(x)) return x;
      const h = 1e-7 * Math.max(1, Math.abs(x));
      let d = (g(x + h) - g(x - h)) / (2 * h);
      if (!Number.isFinite(d) || d === 0) {
        d = (g(x + h) - fx) / h;
        if (!Number.isFinite(d) || d === 0) return null;
      }
      const step = fx / d;
      let lam = 1, xn, fn;
      for (let k = 0; k < 40; k++) {
        xn = x - lam * step;
        fn = g(xn);
        if (Number.isFinite(fn) && Math.abs(fn) < Math.abs(fx)) break;
        lam /= 2;
      }
      if (!Number.isFinite(fn) || Math.abs(fn) >= Math.abs(fx)) return accept(x) ? x : null;
      x = xn; fx = fn;
    }
    return accept(x) ? x : null;
  }

  function brent(g, a, b, fa, fb, accept) {
    // Bisection/secant hybrid (Illinois-flavoured regula falsi with bisection guard).
    for (let it = 0; it < 200; it++) {
      let m = b - fb * (b - a) / (fb - fa);
      if (!(m > Math.min(a, b) && m < Math.max(a, b))) m = (a + b) / 2;
      if (it % 3 === 2) m = (a + b) / 2;
      const fm = g(m);
      if (!Number.isFinite(fm)) return null;
      if (accept(m)) return m;
      if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; fb = fm; }
      if (Math.abs(b - a) <= 1e-15 * Math.max(1, Math.abs(a))) return accept(m) ? m : (Math.abs(fa) < Math.abs(fb) ? a : b);
    }
    return null;
  }

  /** Solve g(x)=0 numerically, starting near x0. */
  function solve1D(g, x0, accept) {
    const starts = [x0, 1, 0.1, -1, 10, 0.01, -10, 100, 1e-3, 1000, -100, 1e4, 1e-6, 1e6];
    const seen = new Set();
    for (const s of starts) {
      if (!Number.isFinite(s) || seen.has(s)) continue;
      seen.add(s);
      const r = newton1D(g, s, accept);
      if (r !== null) return r;
    }
    // Bracket scan on a logarithmic grid.
    const pts = [0];
    for (let k = -8; k <= 10; k += 0.25) { pts.push(Math.pow(10, k)); pts.push(-Math.pow(10, k)); }
    pts.sort((a, b) => a - b);
    let pa = null, fa = null;
    for (const p of pts) {
      const fp = g(p);
      if (!Number.isFinite(fp)) { pa = null; continue; }
      if (accept(p)) return p;
      if (pa !== null && Math.sign(fp) !== Math.sign(fa)) {
        const r = brent(g, pa, p, fa, fp, accept);
        if (r !== null && accept(r)) return r;
      }
      pa = p; fa = fp;
    }
    return null;
  }

  /** Solve one rule for variable v given env. Returns a finite number or NaN. */
  function solveRuleFor(rule, v, env, hint) {
    const nL = countVar(rule.lhs, v), nR = countVar(rule.rhs, v);
    const accept = (x) => {
      env[v] = x;
      const r = scaledResidual(rule, env);
      return Number.isFinite(r) && Math.abs(r) < TOL * 10;
    };
    // 1) Symbolic isolation (exactly one occurrence).
    if (nL + nR === 1) {
      try {
        const side = nL ? rule.lhs : rule.rhs;
        const other = nL ? rule.R : rule.L;
        const target = other(env);
        if (Number.isFinite(target)) {
          const x = isolate(side, v, target, env, hint);
          if (x !== undefined && Number.isFinite(x) && accept(x)) return x;
        }
      } catch (_) { /* fall through to numeric */ }
    }
    // 2) Numeric root finding.
    const g = (x) => { env[v] = x; return rule.L(env) - rule.R(env); };
    const x0 = Number.isFinite(hint) ? hint : 1;
    const x = solve1D(g, x0, accept);
    if (x !== null && accept(x)) return x;
    delete env[v];
    return NaN;
  }

  // ----------------------------------------------------------- direct solver

  /**
   * Consecutive substitution: keep solving rules that have exactly one unknown.
   * Mutates env and known. Returns { used, stalled, failed, checks }.
   */
  function directSolve(model, env, known, hints) {
    const rules = model.rules.filter((r) => r.ok);
    const used = new Set();
    const failed = new Set();
    let progress = true;
    while (progress) {
      progress = false;
      for (const rule of rules) {
        if (used.has(rule.index) || failed.has(rule.index)) continue;
        const unk = rule.vars.filter((v) => !known.has(v));
        if (unk.length !== 1) continue;
        const v = unk[0];
        const hint = hints && Number.isFinite(hints[v]) ? hints[v] : undefined;
        const x = solveRuleFor(rule, v, env, hint);
        if (Number.isFinite(x)) {
          env[v] = x; known.add(v); used.add(rule.index); progress = true;
        } else {
          failed.add(rule.index);
        }
      }
    }
    const stalled = [], checks = [];
    for (const rule of rules) {
      if (used.has(rule.index)) continue;
      const unk = rule.vars.filter((v) => !known.has(v));
      if (unk.length) stalled.push(rule.index);
      else checks.push(rule.index);
    }
    return { used, failed, stalled, checks };
  }

  /** Same propagation as directSolve but only tracks which variables are known. */
  function structural(model, known) {
    known = new Set(known);
    const rules = model.rules.filter((r) => r.ok);
    const used = new Set();
    let progress = true;
    while (progress) {
      progress = false;
      for (const rule of rules) {
        if (used.has(rule.index)) continue;
        const unk = rule.vars.filter((v) => !known.has(v));
        if (unk.length === 1) { known.add(unk[0]); used.add(rule.index); progress = true; }
      }
    }
    const stalled = [], checks = [];
    for (const rule of rules) {
      if (used.has(rule.index)) continue;
      if (rule.vars.some((v) => !known.has(v))) stalled.push(rule.index);
      else checks.push(rule.index);
    }
    return { known, used, stalled, checks };
  }

  // -------------------------------------------------------- linear algebra

  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        if (f === 0) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  const sumSq = (r) => r.reduce((s, x) => s + x * x, 0);
  const maxAbs = (r) => r.reduce((s, x) => Math.max(s, Math.abs(x)), 0);

  /**
   * Levenberg-Marquardt on F: R^n -> R^m. Near a root of a square system with
   * small damping this is plain Newton-Raphson, which is what TK!Solver used.
   */
  function levenbergMarquardt(F, x0, opts) {
    const maxIter = (opts && opts.maxIter) || 200;
    let x = x0.slice();
    let r = F(x);
    if (!r) return { ok: false, x, iterations: 0, reason: 'could not evaluate the model at the guess values' };
    let cost = sumSq(r);
    let lambda = 1e-3;
    const n = x.length;
    for (let it = 1; it <= maxIter; it++) {
      if (r.length === 0 || maxAbs(r) < TOL) return { ok: true, x, iterations: it - 1, residual: maxAbs(r) };
      // Central-difference Jacobian.
      const J = r.map(() => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const h = 1e-6 * Math.max(1, Math.abs(x[j]));
        const xp = x.slice(); xp[j] += h;
        const xm = x.slice(); xm[j] -= h;
        let rp = F(xp), rm = F(xm), denom = 2 * h;
        if (!rp && !rm) continue;
        if (!rp) { rp = r; denom = h; }
        if (!rm) { rm = r; denom = h; }
        for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / denom;
      }
      const A = [], g = new Array(n).fill(0);
      for (let a = 0; a < n; a++) {
        A.push(new Array(n).fill(0));
        for (let b = 0; b < n; b++) {
          let s = 0;
          for (let i = 0; i < r.length; i++) s += J[i][a] * J[i][b];
          A[a][b] = s;
        }
        for (let i = 0; i < r.length; i++) g[a] += J[i][a] * r[i];
      }
      let accepted = false;
      while (lambda < 1e15) {
        const D = A.map((row, i) => row.map((v, k) => (i === k ? v + lambda * Math.max(v, 1e-12) : v)));
        const dx = solveLinear(D, g.map((v) => -v));
        if (dx && dx.every(Number.isFinite)) {
          const xn = x.map((v, i) => v + dx[i]);
          const rn = F(xn);
          if (rn) {
            const cn = sumSq(rn);
            if (cn < cost) {
              const tiny = dx.every((d, i) => Math.abs(d) <= 1e-15 * Math.max(1, Math.abs(x[i])));
              x = xn; r = rn; cost = cn; lambda = Math.max(lambda / 5, 1e-15);
              accepted = true;
              if (tiny) {
                return maxAbs(r) < CHECK_TOL
                  ? { ok: true, x, iterations: it, residual: maxAbs(r) }
                  : { ok: false, x, iterations: it, residual: maxAbs(r), reason: 'iteration stalled — try different guesses' };
              }
              break;
            }
          }
        }
        lambda *= 4;
      }
      if (!accepted) {
        return maxAbs(r) < CHECK_TOL
          ? { ok: true, x, iterations: it, residual: maxAbs(r) }
          : { ok: false, x, iterations: it, residual: maxAbs(r), reason: 'no further progress — try different guesses' };
      }
    }
    return maxAbs(r) < CHECK_TOL
      ? { ok: true, x, iterations: maxIter, residual: maxAbs(r) }
      : { ok: false, x, iterations: maxIter, residual: maxAbs(r), reason: 'iteration limit reached' };
  }

  // --------------------------------------------------------------- solving

  const START_VALUES = [1, 10, 0.1, 3, 30, 100, 0.01, -1, 0.5, 5, 20, 50, 300, 1000, -10, 0.001];

  /**
   * Pick extra guess ("tear") variables so the direct solver can finish.
   * Greedy: guess the unknown that appears in the most stalled rules. Ties
   * produce alternative sets, tried in order if the first does not converge.
   */
  function autoTearSets(model, seed, limit) {
    const complete = (state, picks) => {
      let s = state;
      const out = picks.slice();
      while (s.stalled.length) {
        const ranked = rankUnknowns(model, s);
        if (!ranked.length) break;
        out.push(ranked[0]);
        s = structural(model, new Set([...s.known, ranked[0]]));
      }
      return out;
    };
    const firsts = rankUnknowns(model, seed);
    const sets = [];
    const seen = new Set();
    for (const v of firsts) {
      const set = complete(structural(model, new Set([...seed.known, v])), [v]);
      const key = set.slice().sort().join('|');
      if (!seen.has(key)) { seen.add(key); sets.push(set); }
      if (sets.length >= limit) break;
    }
    return sets;
  }

  function rankUnknowns(model, s) {
    const counts = new Map();
    for (const idx of s.stalled) {
      for (const v of model.rules[idx].vars) if (!s.known.has(v)) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return model.variables.filter((v) => counts.has(v))
      .sort((a, b) => counts.get(b) - counts.get(a) || model.variables.indexOf(a) - model.variables.indexOf(b));
  }

  /** Residual vector for the iterative solver; null when the model can't be evaluated. */
  function makeResidualFn(model, baseEnv, baseKnown, allGuess, residualRules, hints) {
    const run = (x) => {
      const e = Object.assign({}, baseEnv);
      const k = new Set(baseKnown);
      allGuess.forEach((v, i) => { e[v] = x[i]; k.add(v); });
      const dd = directSolve(model, e, k, hints);
      if (dd.stalled.length) return null;
      for (const idx of dd.failed) if (!residualRules.includes(idx)) return null;
      const out = [];
      for (const idx of residualRules) {
        const rr = scaledResidual(model.rules[idx], e);
        if (!Number.isFinite(rr)) return null;
        out.push(rr);
      }
      return { out, env: e };
    };
    const F = (x) => { const r = run(x); return r ? r.out : null; };
    F.envAt = (x) => { const r = run(x); return r ? r.env : null; };
    return F;
  }

  /**
   * Solve a model.
   *   inputs   {name: number}   known values (calculation units)
   *   guesses  {name: number}   starting values for the iterative solver
   *   opts.autoGuess            pick extra guess variables automatically if needed
   *   opts.hints {name: number} preferred values for 1-D root finding (e.g. last answer)
   *
   * Returns {
   *   ok, mode: 'direct'|'iterative', values {name:number}, message,
   *   ruleStatus [ 'ok' | 'unsatisfied' | 'unsolved' | 'error' | 'blank' ],
   *   iterations, guessed [names], autoGuessed [names]
   * }
   */
  function solve(model, inputs, guesses, opts) {
    opts = opts || {};
    guesses = guesses || {};
    const hints = Object.assign({}, opts.hints || {}, guesses);
    const env = {};
    const known = new Set();
    for (const [k, v] of Object.entries(inputs || {})) {
      if (Number.isFinite(v)) { env[k] = v; known.add(k); }
    }
    const result = { ok: true, mode: 'direct', values: {}, message: '', iterations: 0, guessed: [], autoGuessed: [] };

    const syntaxErrors = model.rules.filter((r) => !r.blank && !r.ok);

    // ---- Pass 1: direct solver
    const d = directSolve(model, env, known, hints);
    let finalEnv = env;

    if (d.stalled.length || d.failed.size) {
      // ---- Pass 2: iterative solver
      const baseKnown = new Set(known);
      const baseEnv = Object.assign({}, env);
      const guessVars = Object.keys(guesses).filter((v) => !baseKnown.has(v) && model.variables.includes(v) && Number.isFinite(guesses[v]));
      result.guessed = guessVars;
      const seed = structural(model, new Set([...baseKnown, ...guessVars]));
      const tearSets = seed.stalled.length && opts.autoGuess !== false
        ? autoTearSets(model, seed, 6)
        : [[]];
      let s = seed;
      if (tearSets.length === 0) tearSets.push([]);

      // Is the model determinable with the first tear set at all?
      s = structural(model, new Set([...seed.known, ...tearSets[0]]));
      if (s.stalled.length) {
        const missing = new Set();
        for (const idx of s.stalled) for (const v of model.rules[idx].vars) if (!s.known.has(v)) missing.add(v);
        result.ok = false;
        result.message = `Not enough information. Supply an input or a guess for: ${[...missing].join(', ')}`;
      } else if (guessVars.length + tearSets[0].length === 0) {
        // Direct solver failed on a rule but there is nothing to iterate on.
        result.ok = false;
        const bad = [...d.failed].map((i) => i + 1);
        result.message = `Could not solve rule ${bad.join(', ')} — no real solution found`;
      } else {
        // Try each tear set and a handful of starting points; keep the first
        // converged answer, else the best failure.
        let best = null, runs = 0, under = null;
        outer:
        for (const auto of tearSets) {
          const allGuess = guessVars.concat(auto);
          const st = structural(model, new Set([...baseKnown, ...allGuess]));
          if (st.stalled.length) continue;
          const residualRules = st.checks.filter((idx) => model.rules[idx].vars.some((v) => !baseKnown.has(v)));
          if (residualRules.length < allGuess.length) { under = under || allGuess; continue; }
          const F = makeResidualFn(model, baseEnv, baseKnown, allGuess, residualRules, hints);
          for (const startVal of START_VALUES) {
            const x0 = allGuess.map((v, i) => (i < guessVars.length || Number.isFinite(hints[v])) && startVal === START_VALUES[0]
              ? (Number.isFinite(guesses[v]) ? guesses[v] : Number.isFinite(hints[v]) ? hints[v] : 1)
              : (i < guessVars.length ? guesses[v] : startVal));
            if (!F(x0)) continue;
            const lm = levenbergMarquardt(F, x0, opts);
            runs++;
            const env2 = F.envAt(lm.x);
            const cand = { lm, env: env2, auto, allGuess, residualRules };
            if (lm.ok) { best = cand; break outer; }
            if (!best || (lm.residual || Infinity) < (best.lm.residual || Infinity)) best = cand;
            if (runs >= 40) break outer;
          }
        }
        result.mode = 'iterative';
        if (!best && under) {
          result.ok = false;
          result.message = `Not enough information — more unknowns than equations. Supply an input for one of: ${under.join(', ')}`;
        } else if (!best) {
          result.ok = false;
          result.autoGuessed = tearSets[0];
          result.message = 'Iterative solver could not evaluate the model at any starting guess — supply better guesses';
        } else {
          const { lm, env: env2, auto, allGuess, residualRules } = best;
          result.autoGuessed = auto;
          result.iterations = lm.iterations;
          if (env2) finalEnv = env2;
          if (!lm.ok) {
            result.ok = false;
            result.message = `Iterative solver did not converge (${lm.reason}).`;
          } else {
            const nG = allGuess.length, nR = residualRules.length;
            result.message = `Iterative solver converged in ${lm.iterations} iteration${lm.iterations === 1 ? '' : 's'}`;
            if (nR > nG) result.message += ' (over-determined: least-squares fit)';
          }
        }
      }
    }

    // ---- Collect values and rule status
    for (const v of model.variables) {
      if (Number.isFinite(finalEnv[v]) && !(v in (inputs || {}) && Number.isFinite(inputs[v]))) result.values[v] = finalEnv[v];
    }
    result.ruleStatus = model.rules.map((rule) => {
      if (rule.blank) return 'blank';
      if (!rule.ok) return 'error';
      if (rule.vars.some((v) => !Number.isFinite(finalEnv[v]))) return 'unsolved';
      const r = scaledResidual(rule, finalEnv);
      return Number.isFinite(r) && Math.abs(r) < CHECK_TOL ? 'ok' : 'unsatisfied';
    });
    const unsat = result.ruleStatus.filter((s) => s === 'unsatisfied').length;
    const unsolved = result.ruleStatus.filter((s) => s === 'unsolved').length;
    if (result.ok && unsat) {
      result.ok = false;
      result.message = `${unsat} rule${unsat > 1 ? 's are' : ' is'} not satisfied — the inputs are inconsistent`;
    }
    if (result.ok && !result.message) {
      const nOk = result.ruleStatus.filter((s) => s === 'ok').length;
      result.message = `Direct solver: ${nOk} rule${nOk === 1 ? '' : 's'} satisfied`;
      if (unsolved) {
        result.ok = false;
        result.message = `Not enough information — ${unsolved} rule${unsolved > 1 ? 's' : ''} unsolved`;
      }
    }
    if (syntaxErrors.length) {
      result.message += ` · ${syntaxErrors.length} rule${syntaxErrors.length > 1 ? 's have' : ' has'} syntax errors`;
    }
    return result;
  }

  /**
   * List solving: solve once per row. listInputs maps variable -> array.
   * Each solution seeds the next one (continuation), which helps iterative models.
   */
  function listSolve(model, inputs, guesses, listInputs, opts) {
    const names = Object.keys(listInputs);
    const n = names.reduce((m, k) => Math.max(m, listInputs[k].length), 0);
    const rows = [];
    let prev = {};
    let lastGuesses = Object.assign({}, guesses);
    for (let i = 0; i < n; i++) {
      const inp = Object.assign({}, inputs);
      let any = false;
      for (const k of names) {
        const v = listInputs[k][i];
        if (Number.isFinite(v)) { inp[k] = v; any = true; } else { delete inp[k]; }
      }
      if (!any) { rows.push(null); continue; }
      const res = solve(model, inp, lastGuesses, Object.assign({}, opts, { hints: Object.assign({}, prev) }));
      rows.push(res);
      if (res.ok) {
        prev = res.values;
        lastGuesses = {};
        for (const g of Object.keys(guesses)) if (Number.isFinite(res.values[g])) lastGuesses[g] = res.values[g]; else lastGuesses[g] = guesses[g];
      }
    }
    return rows;
  }

  // ------------------------------------------------------------------ units

  /**
   * Units sheet rows: { from, to, factor, offset }  meaning  to = from*factor + offset.
   * A variable's display unit is looked up in "from"; the calculation is done in "to".
   */
  function makeUnits(rows) {
    const map = new Map();
    for (const r of rows || []) {
      const from = (r.from || '').trim();
      const factor = typeof r.factor === 'number' ? r.factor : evalConst(r.factor);
      const offset = r.offset === '' || r.offset == null ? 0 : (typeof r.offset === 'number' ? r.offset : evalConst(r.offset));
      if (from && Number.isFinite(factor) && factor !== 0 && Number.isFinite(offset)) {
        map.set(from, { to: (r.to || '').trim(), factor, offset });
      }
    }
    return {
      has: (u) => map.has((u || '').trim()),
      calcUnit: (u) => { const c = map.get((u || '').trim()); return c ? c.to : (u || ''); },
      toCalc: (u, x) => { const c = map.get((u || '').trim()); return c ? x * c.factor + c.offset : x; },
      fromCalc: (u, x) => { const c = map.get((u || '').trim()); return c ? (x - c.offset) / c.factor : x; },
    };
  }

  // ------------------------------------------------------------- formatting

  function formatNumber(x, digits) {
    digits = digits || 8;
    if (!Number.isFinite(x)) return String(x);
    if (x === 0) return '0';
    const ax = Math.abs(x);
    if (ax >= 1e-4 && ax < 1e9) {
      let s = x.toPrecision(digits);
      if (s.includes('e')) s = String(Number(s));
      if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
      return s;
    }
    let s = x.toExponential(digits - 1);
    s = s.replace(/\.?0+e/, 'e').replace('e+', 'E').replace('e-', 'E-');
    return s;
  }

  return {
    tokenize, parseRule, parseExpr, compile, toText, evalConst, collectVars,
    buildModel, solve, listSolve, makeUnits, formatNumber,
    // exposed for tests
    _internal: { solve1D, levenbergMarquardt, solveLinear, isolate, structural, directSolve },
    FUNCTIONS: Object.keys(FUNCS),
  };
});
