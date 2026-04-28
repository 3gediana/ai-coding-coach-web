import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true
});
const p = await b.newPage();
await p.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
// probe all buttons with their text + position
const btns = await p.evaluate(() => {
  return Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.innerText?.trim().slice(0,30),
    title: b.title,
    ariaLabel: b.getAttribute('aria-label'),
    cls: b.className?.slice(0,60),
    rect: (() => { const r = b.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y)}; })(),
  }));
});
console.log(JSON.stringify(btns, null, 2));
await b.close();
