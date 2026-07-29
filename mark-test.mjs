import { writeFileSync } from "node:fs";
const targets = await (await fetch(`http://127.0.0.1:9223/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener("open", r));
let id = 0; const pending = new Map();
socket.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, p={}) => new Promise((res) => { pending.set(++id, res); socket.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400)); return r.result.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable");
await send("Page.navigate", { url: "http://10.0.0.102:5173/anim.html?motion=hurl&phase=0.30&zoom=5.5" });
await wait(3800);

// Does every mark sit where the thumb sits, before anything is touched?
const alignment = await ev(`
  (() => {
    const rows = [...document.querySelectorAll('.anim-control')];
    const offsets = [];
    for (const row of rows) {
      const mark = row.querySelector('.anim-saved-mark');
      if (!mark) continue;
      const slider = row.querySelector('input[type=range]');
      const track = row.querySelector('.anim-slider').getBoundingClientRect();
      const thumb = 12;
      const min = Number(slider.min), max = Number(slider.max), value = Number(slider.value);
      const thumbX = track.left + thumb / 2 + (track.width - thumb) * ((value - min) / (max - min));
      const markX = mark.getBoundingClientRect().left + 1;
      offsets.push(Math.abs(thumbX - markX));
    }
    return { marks: offsets.length, controls: rows.length,
      worstPixels: Math.max(...offsets).toFixed(2) };
  })()
`);

// Drag one, check the mark stays put, then double-click the row to go back.
const cycle = await ev(`
  (() => {
    const section = [...document.querySelectorAll('.anim-section')].find(s => s.querySelector('h2').textContent.includes('free arm'));
    const group = [...section.querySelectorAll('.anim-beat')].find(b => b.querySelector('h3').textContent.includes('up'));
    const row = [...group.querySelectorAll('.anim-control')].find(c => c.querySelector('span').textContent === 'base');
    const slider = row.querySelector('input[type=range]');
    const number = row.querySelector('input[type=number]');
    const markLeft = () => row.querySelector('.anim-saved-mark').style.left;
    const before = { value: slider.value, mark: markLeft(), tuning: window.__anim.tuning.freeArm.hurl.upperX.base };
    slider.value = '0.75';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    const dragged = { value: slider.value, number: number.value, mark: markLeft(), tuning: window.__anim.tuning.freeArm.hurl.upperX.base };
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const reset = { value: slider.value, number: number.value, mark: markLeft(), tuning: window.__anim.tuning.freeArm.hurl.upperX.base };
    return { before, dragged, reset };
  })()
`);

// An added key has no saved counterpart, and the whole arc's marks stand down.
const added = await ev(`
  (() => {
    const before = document.querySelectorAll('.anim-key .anim-saved-mark').length;
    const section = [...document.querySelectorAll('.anim-section')].find(s => s.querySelector('h2').textContent.includes('arm arc'));
    [...section.querySelectorAll('button')].find(b => b.textContent.includes('Add a key')).click();
    return { markedBefore: before, markedAfter: document.querySelectorAll('.anim-key .anim-saved-mark').length,
      keys: window.__anim.tuning.armKeys.hurl.length };
  })()
`);
await wait(400);
await ev(`document.querySelector('#revert').click()`);
await wait(400);
const afterRevert = await ev(`({ keys: window.__anim.tuning.armKeys.hurl.length, marks: document.querySelectorAll('.anim-key .anim-saved-mark').length })`);

await ev(`[...document.querySelectorAll('.anim-section h2')].find(h => h.textContent.includes('free arm')).scrollIntoView()`);
await wait(500);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/anim-shots/saved-marks.png", Buffer.from(shot.result?.data ?? shot.data, "base64"));
console.log(JSON.stringify({ alignment, cycle, added, afterRevert }, null, 1));
socket.close();
