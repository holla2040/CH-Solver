// Run with:  node test/engine.test.js
'use strict';
const E = require('../js/engine.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}`, extra !== undefined ? extra : ''); }
}
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function run(rules, inputs, guesses, opts) {
  const m = E.buildModel(rules);
  return E.solve(m, inputs, guesses || {}, opts || {});
}

// --- parser
check('parse precedence', near(E.evalConst('-2^2'), -4));
check('parse right assoc', near(E.evalConst('2^3^2'), 512));
check('parse funcs', near(E.evalConst('sqrt(16) + ln(exp(2)) + log(100)'), 8));
check('parse pi', near(E.evalConst('2*pi'), 2 * Math.PI));
check('parse ** alias', near(E.evalConst('3**2'), 9));
check('parse exponent', near(E.evalConst('1.5e3'), 1500));
check('comment line is blank', E.parseRule('" just a comment') === null);
check('rule needs =', (() => { try { E.parseRule('a + b'); return false; } catch (e) { return /=/.test(e.message); } })());
check('variables collected', E.buildModel(['a + b = c / d']).variables.join() === 'a,b,c,d');

// --- direct solver: any variable of any rule
let r = run(['a + b = c / d'], { a: 1, b: 2, d: 4 });
check('direct solve for c', r.ok && near(r.values.c, 12), r);
r = run(['a + b = c / d'], { a: 1, b: 2, c: 12 });
check('direct solve for d (denominator)', r.ok && near(r.values.d, 4), r);

// --- chain
r = run(['c^2 = a^2 + b^2', 'area = a*b/2', 'theta = atan(b/a)*180/pi'], { a: 3, b: 4 });
check('triangle forward', r.ok && near(r.values.c, 5) && near(r.values.area, 6) && near(r.values.theta, 53.130102354), r);

// --- backsolve needing iteration (auto guess)
r = run(['c^2 = a^2 + b^2', 'area = a*b/2', 'theta = atan(b/a)*180/pi'], { c: 5, area: 6 }, { a: 2 });
check('triangle backsolve', r.ok && r.mode === 'iterative' && (near(r.values.a, 3) || near(r.values.a, 4)), r);

r = run(['c^2 = a^2 + b^2', 'area = a*b/2'], { c: 5, area: 6 }, {}, { autoGuess: false });
check('no guess, autoGuess off -> error', !r.ok && /Not enough information/.test(r.message), r.message);

// --- simultaneous nonlinear 3x3
r = run(['x + y + z = 6', 'x*y*z = 6', 'x^2 + y^2 + z^2 = 14'], {}, { x: 0.5, y: 1.8 });
const sorted = r.ok ? [r.values.x, r.values.y, r.values.z].sort((a, b) => a - b) : [];
check('3x3 nonlinear', r.ok && near(sorted[0], 1) && near(sorted[1], 2) && near(sorted[2], 3), r);

// --- loan: solve rate (implicit, numeric 1-D)
const loan = ['pmt = P * i / (1 - (1 + i)^-n)', 'i = rate / 100 / 12', 'n = years * 12', 'total = pmt * n', 'interest = total - P'];
r = run(loan, { P: 250000, rate: 6.5, years: 30 });
check('loan payment', r.ok && near(r.values.pmt, 1580.17, 1e-5), r.values.pmt);
r = run(loan, { P: 250000, pmt: 1580.1707, years: 30 });
check('loan backsolve rate', r.ok && near(r.values.rate, 6.5, 1e-5), r);

// --- Colebrook (f appears twice)
const cole = ['1/sqrt(f) = -2*log(eps/D/3.7 + 2.51/(Re*sqrt(f)))', 'Re = rho*V*D/mu', 'dP = f*(L/D)*rho*V^2/2'];
r = run(cole, { rho: 998, V: 2, D: 0.1, mu: 0.001, eps: 0.000045, L: 100 });
check('colebrook', r.ok && near(r.values.f, 0.01766, 5e-3), r);

// --- voltage divider: forward, then backsolve R2 (appears twice)
const div = ['Vout = Vin * R2 / (R1 + R2)', 'I = Vin / (R1 + R2)'];
r = run(div, { Vin: 12, R1: 10000, R2: 4700 });
check('divider Vout', r.ok && near(r.values.Vout, 12 * 4700 / 14700), r);
r = run(div, { Vin: 12, R1: 10000, Vout: 3.3 });
check('divider backsolve R2', r.ok && near(r.values.R2, 3.3 * 10000 / 8.7), r);

// --- crossed ladders
r = run(['h1 = sqrt(L1^2 - w^2)', 'h2 = sqrt(L2^2 - w^2)', '1/c = 1/h1 + 1/h2'], { L1: 30, L2: 20, c: 10 }, { w: 10 });
check('crossed ladders', r.ok && near(r.values.w, 12.3118, 1e-4), r);

// --- inconsistent inputs
r = run(['a + b = c'], { a: 1, b: 2, c: 4 });
check('inconsistent detected', !r.ok && r.ruleStatus[0] === 'unsatisfied', r);

// --- syntax error doesn't break others
r = run(['a = 2*b', 'c = (a'], { b: 3 });
check('syntax error isolated', near(r.values.a, 6) && r.ruleStatus[1] === 'error', r);

// --- even power sign follows the guess
r = run(['x^2 = 9'], {}, { x: -2 });
check('even power picks guess branch', r.ok && near(r.values.x, -3), r);

// --- units
const U = E.makeUnits([{ from: 'degC', to: 'K', factor: 1, offset: 273.15 }, { from: 'L', to: 'm3', factor: 0.001 }, { from: 'atm', to: 'Pa', factor: 101325 }]);
check('units toCalc', near(U.toCalc('degC', 0), 273.15));
check('units fromCalc', near(U.fromCalc('L', 0.0224), 22.4));
r = run(['P*V = n*R*T'], { P: U.toCalc('atm', 1), T: U.toCalc('degC', 0), n: 1, R: 8.314462618 });
check('ideal gas', r.ok && near(U.fromCalc('L', r.values.V), 22.414, 1e-4), r);

// --- list solve
const m = E.buildModel(['vx = v0*cos(rad(theta))', 'vy = v0*sin(rad(theta))', 't = 2*vy/g', 'range = vx*t']);
const rows = E.listSolve(m, { v0: 30, g: 9.81 }, {}, { theta: [15, 30, 45, 60, 75] });
check('list solve length', rows.length === 5);
check('list solve 45 deg max', rows[2].ok && near(rows[2].values.range, 900 / 9.81));

// --- list solve with iteration and continuation
const m2 = E.buildModel(['x^3 + x = k']);
const rows2 = E.listSolve(m2, {}, { x: 1 }, { k: [1, 2, 5, 10, 30] });
check('list solve values', rows2.every((q, i) => q.ok && near(q.values.x ** 3 + q.values.x, [1, 2, 5, 10, 30][i])), rows2.map((q) => q.message));

// --- formatting
check('format', E.formatNumber(1580.17066) === '1580.1707' && E.formatNumber(1e-9) === '1E-9' && E.formatNumber(0.5) === '0.5', [E.formatNumber(1580.17066), E.formatNumber(1e-9)]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
