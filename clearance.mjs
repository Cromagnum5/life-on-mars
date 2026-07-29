const targets = await (await fetch(`http://127.0.0.1:9223/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener("open", r));
let id = 0; const pending = new Map();
socket.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, p={}) => new Promise((res) => { pending.set(++id, res); socket.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300)); return r.result.result.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable");
const read = () => ev(`
  (() => {
    const dts = [...document.querySelectorAll('#measures dt')];
    const row = (n) => { const dt = dts.find(d => d.textContent === n); return dt ? dt.nextElementSibling.textContent : null; };
    return { phase: row('phase'), freeArm: row('free arm'), rock: row('rock') };
  })()
`);
const out = [];
for (const phase of [0.00, 0.14, 0.30, 0.42, 0.48, 0.58, 0.70, 0.85, 1.00]) {
  await send("Page.navigate", { url: `http://10.0.0.102:5173/anim.html?motion=hurl&phase=${phase.toFixed(2)}&zoom=5` });
  await wait(2600);
  out.push({ asked: phase, ...(await read()) });
}
console.log(JSON.stringify(out, null, 1));
socket.close();
