#!/usr/bin/env node
// Inline css/ and js/ into one self-contained HTML file.
//   node tools/build-single.js                 -> dist/MKSolver.html (full document)
//   node tools/build-single.js --fragment out  -> head+body content only (for hosts that add their own skeleton)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.filter((a) => !a.startsWith('--'))[0] || path.join(root, 'dist', 'MKSolver.html');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`markers ${a} / ${b} not found`);
  return html.slice(i + a.length, j);
};
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let head = between('<!-- BUILD:HEAD START -->', '<!-- BUILD:HEAD END -->');
let body = between('<!-- BUILD:BODY START -->', '<!-- BUILD:BODY END -->');

// Inline stylesheets, embedding url(../fonts/...) references as data: URIs.
const inlineCss = (f) => read(f).replace(/url\("\.\.\/(fonts\/[^"]+)"\)/g, (_, font) => {
  const b64 = fs.readFileSync(path.join(root, font)).toString('base64');
  return `url("data:font/${path.extname(font).slice(1)};base64,${b64}")`;
});
head = head.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, f) => `<style>\n${inlineCss(f)}\n</style>`);
body = body.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}\n</script>`);

const doc = fragment
  ? `${head.trim()}\n${body.trim()}\n`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head.trim()}\n</head>\n<body>\n${body.trim()}\n</body>\n</html>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
console.log(`wrote ${out} (${(doc.length / 1024).toFixed(1)} KB)`);
