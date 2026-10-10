# CH!Solver

A browser-based, declarative equation solver modeled on **TK!Solver**, the
1980s program where you typed equations in any order, entered whatever you
knew, and it solved for the rest, iterating from your guesses when it had to.

No build step, no dependencies, no server. Open `index.html` in a browser, or
use the single-file version in `dist/ch-solver.html`.

```
Rule Sheet                         Variable Sheet
  c^2 = a^2 + b^2                    St  Input  Name   Output
  area = a * b / 2                        13    c
                                          30    area
                                              a      5
                                              b      12      ← solved by iteration
```

## Running it

* **Use it:** open `index.html` (or `dist/ch-solver.html`) in any modern browser. It also works from `file://`.
* **Test the engine:** `npm test` (Node 18+, no packages needed).
* **Rebuild the single file:** `npm run build`. This inlines `css/` and `js/` into `dist/ch-solver.html`.
* **Host it:** any static host works, including GitHub Pages with the repo root as the site.

## How to use it

1. Type equations in the **Rule Sheet**, one per line. `a + b = c / d` is fine; rules are equations, not assignments.
2. Each variable shows up in the **Variable Sheet**. Put known values in **Input**.
3. Press **!** (or F9, or Ctrl+Enter). Answers appear in **Output**.
4. To work backwards, double-click an output to move it to Input, clear a different input, and press **!** again.

| St | Meaning |
|----|---------|
| *(blank)* | A value in Input is a known input. With no value, the variable is an unknown. |
| `G` | The Input value is a **guess**: a starting point for the iterative solver. |
| `L` | The variable is linked to a **list** of the same name, for List Solve and plots. |

Rule Sheet marks: `*` means the rule isn't satisfied (inconsistent inputs), `!` means a syntax error, and `·` means the rule isn't solved yet.

**Syntax:** `+ - * / ^` (or `**`), parentheses, and `"` to start a comment. Functions: `sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh sqrt exp ln log log10 abs sgn int floor ceil round mod min max deg rad`, plus the constant `pi`. Trig functions use radians, so use `deg()` and `rad()` to convert. Input cells accept constant expressions such as `2*pi` or `1/3`.

**Subsheets**
* **Units:** each row maps a display unit to a calculation unit, where calc = display × factor + add. If a variable's Unit matches a row, you enter and read its value in the display unit, and the rules work in the calculation unit. This covers things like `ft → m`, `mph → m/s`, and `degC → K` (with an offset).
* **Lists:** set St = `L`, then type values or use Fill (from / to / steps). Lists you type are inputs; List Solve fills the others. Each row starts from the previous row's answer, which helps iterative models follow a curve.
* **Plot:** pick an X list and one or more Y lists. The plot uses 1-bit line styles to fit the period.

**Examples menu:** Right Triangle, Three Simultaneous Equations, Mortgage Payment (backsolve the rate), Crossed Ladders, Projectile Range (list solve + units + plot), Pipe Friction (implicit Colebrook equation), and Ideal Gas (unit offsets).

Your model is autosaved in the browser's local storage. Use File → Save / Open for `.chs` files (JSON), or File → Model as Text… to copy or paste a model.

---

## Research: TK!Solver

**Who made it.** TK!Solver ("TK" for *Tool Kit*) was invented by **Milos Konopasek**, a Czech-born mechanical engineer. (He was Czech, not Polish.) It grew out of a "question answering" equation system he had built earlier at the University of Manchester. **Software Arts**, the company Dan Bricklin and Bob Frankston founded to make VisiCalc, developed it with Konopasek as Senior Scientist, and released it in **1982**, first for DOS PCs. Ports followed for other machines, including the TRS-80 Model 4, the DEC Rainbow and Professional, and the **Macintosh**. A Mac edition was listed in Macworld's *Macware News* in the Sept/Oct 1984 issue, and the Macintosh Repository lists it as running on Mac OS 1.0–6.0, so it was available on the very early 128K/512K Macs. I couldn't find a primary source pinning the Mac ship date to 1984 or 1985.

**What happened to it.** Software Arts ran into financial trouble, Lotus bought the company in the mid-1980s, and TK!Solver went to **Universal Technical Systems (UTS)** of Rockford, Illinois. Sources disagree on whether these deals happened in 1984 or 1985. Konopasek went with it as a vice president. UTS still sells TK Solver for Windows today.

**How it worked.** The interface was a set of linked sheets:

* **Rule Sheet:** free-form equations, in any order and in any arrangement (`A + B = C / D`).
* **Variable Sheet:** created automatically from the rules. Its columns were Status, Input, Name, Output, Unit, and Comment.
* **Units, List, Plot, Table and User Function** subsheets.

Behind the sheets were two solvers:

1. **Direct Solver, by consecutive substitution.** It scans the rules for one with exactly one unknown, solves it for that unknown (inverting the equation), adds the result to the known values, and repeats. This alone handles "backsolving": the same model answers different questions depending on which values you enter.
2. **Iterative Solver, by Newton–Raphson.** When every remaining rule has two or more unknowns, the direct solver is stuck. You give one or more variables a **guess** (status `G`). TK treats the guesses as known, runs the direct solver, and gets some rules that are fully determined but not satisfied. Their errors become residuals, and Newton–Raphson adjusts the guesses until the residuals are zero. This is how it solved simultaneous nonlinear equations with as many equations as unknowns.

**List solving** re-ran the model once per element of input lists, and that was what drove plots and tables.

## Is this feasible in JavaScript?

**Yes, and comfortably.** Nothing in TK!Solver needs more than a 1984 Macintosh had, and a modern JS engine is many thousands of times faster. The pieces map directly:

| TK!Solver | CH!Solver (this repo) |
|-----------|-----------------------|
| Rule parser | Hand-written tokenizer and recursive-descent parser to an AST, compiled to JS closures (`js/engine.js`) |
| Direct solver | Consecutive substitution. A rule with one unknown is inverted **symbolically** when the unknown appears once (through `+ − × ÷ ^`, `sin`/`asin`, `exp`/`ln`, `sqrt`, …). Otherwise it falls back to a **numeric 1-D root finder** (damped Newton, multi-start, then a bracketing scan with a regula-falsi/bisection hybrid). |
| Iterative solver (Newton–Raphson on guesses) | Same structure as TK: guesses → direct solver → leftover rules become residuals. These are driven to zero with **Levenberg–Marquardt**, a damped Gauss–Newton that becomes plain Newton–Raphson near the answer and doesn't blow up far from it. The Jacobian comes from central differences. |
| "Supply a guess" | Still supported. CH!Solver adds **Auto-guess** (on by default, can be turned off in the Solve menu): if you didn't give enough guesses, it picks variables using a tearing heuristic (guess the unknown shared by the most stuck rules), tries alternative choices and several starting values, and tells you which variables it guessed. |
| List solver | Re-solves per row, seeding each row from the last answer (continuation). |
| Units sheet | Display ↔ calculation unit conversion with factor and offset. |
| Plot sheet | `<canvas>` line plot. |

Typical models solve in well under a millisecond. The 3×3 nonlinear example converges in about 5–12 Newton iterations.

**Known limits, compared with the real TK!Solver:**
* There are no user-defined functions, tables, or interpolated lookup functions yet. These would be natural next additions.
* Iteration finds *a* root, not all of them. Like TK, which root you get depends on the guesses. For `x^2 = 9`, the sign of the guess picks the branch.
* There's no complex-number support, and no symbolic simplification beyond isolating a single occurrence of the unknown.

## Project layout

```
index.html            app shell (Variable / Rule sheets, subsheet tabs, menus)
css/style.css         1-bit, 1985-Mac look; light and dark (inverse video)
fonts/                ChicagoFLF (public-domain Chicago revival by Robin Casady)
js/engine.js          parser, direct + iterative solvers, list solve, units (no DOM; runs in Node)
js/examples.js        example models
js/app.js             UI
test/engine.test.js   engine tests (npm test)
tools/build-single.js inlines everything into dist/ch-solver.html
```

## Sources

* [TK Solver, Wikipedia](https://en.wikipedia.org/wiki/TK_Solver)
* [Milos Konopasek, Wikipedia](https://en.wikipedia.org/wiki/Milos_Konopasek)
* [Software Arts, Wikipedia](https://en.wikipedia.org/wiki/Software_Arts)
* [TK!Solver for Macintosh, Macintosh Repository](https://www.macintoshrepository.org/16519-tk-solver)
* [TK!Solver 1984 (TRS-80 Model 4), Computer History Museum](https://www.computerhistory.org/collections/catalog/102689457)
* [Using TK Solver Plus, Univ. of Maryland course notes](https://terpconnect.umd.edu/~toh/Chem623/UsingTKSolverPlus.html)
* [TK Solver 3.0 review, Design News](https://www.designnews.com/motion-control/tk-solver-3-0)
* [TK Solver 5.0, R&D World](https://www.rdworldonline.com/tksolver-5-0-rules-based-mathematical-solutions/)

The interface font is **ChicagoFLF**, Robin Casady's public-domain revival of Susan Kare's original Macintosh Chicago (see `fonts/README.ChicagoFLF.txt`). It's bundled locally, so the app works offline.

TK!Solver is a trademark of Universal Technical Systems, Inc. CH!Solver is an independent homage and is not affiliated with UTS.
