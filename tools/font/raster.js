// Rasterize ChicagoFLF on its 12px grid (10x supersampled) -> chicago-12px.json.
// Needs Playwright + Chromium:  node tools/font/raster.js
const { chromium } = require(process.env.PW || 'playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
require('fs').writeFileSync(require('path').join(__dirname,'../../.raster.html'),`<style>@font-face{font-family:C;src:url(tools/font/ChicagoFLF.woff)}</style><span style="font-family:C">x</span>`);
await p.goto('file://'+require('path').join(__dirname,'../../.raster.html'));await p.waitForTimeout(500);
const chars=[];for(let i=32;i<127;i++)chars.push(String.fromCharCode(i));
chars.push(...'·→←↑↓✓✗×°—–…“”‘’•÷±≤≥≠√π©®™µ'.split(''));
const r=await p.evaluate(async(chars)=>{await document.fonts.load('12px C');const K=10,S=12*K,H=16,BASE=12;const out={};
for(const ch of chars){const c=document.createElement('canvas');c.width=40*K;c.height=H*K;const x=c.getContext('2d');x.font=S+'px C';x.textBaseline='alphabetic';
const w=x.measureText(ch).width/K;x.fillText(ch,4*K,BASE*K);const d=x.getImageData(0,0,40*K,H*K).data;const rows=[];
for(let y=0;y<H;y++){let row='';for(let xx=0;xx<40;xx++){let n=0;for(const oy of [3,5,7])for(const ox of [3,5,7])if(d[((y*K+oy)*40*K+xx*K+ox)*4+3]>=128)n++;row+=n>=5?'#':'.';}rows.push(row);}
out[ch]={w,rows};}
// check whether glyph exists in C: compare width to fallback
const c2=document.createElement('canvas').getContext('2d');
for(const ch of chars){c2.font='12px C';const a=c2.measureText(ch).width;c2.font='12px monospace';const m=c2.measureText(ch).width;c2.font='12px serif';const s=c2.measureText(ch).width; out[ch].fb=(a===m||a===s);}
return out;},chars);
require('fs').writeFileSync(require('path').join(__dirname,'chicago-12px.json'),JSON.stringify(r));
await b.close();})();
