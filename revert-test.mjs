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
await send("Page.navigate", { url: "http://10.0.0.102:5173/anim.html?motion=hurl&phase=0.30&zoom=5.5" });
await wait(3800);

const snapshot = () => ev(`
  (() => {
    const t = window.__anim.tuning;
    return {
      freeArmShoulderUp: t.freeArm.hurl.upperX.base,
      freeArmElbowWhip: t.freeArm.hurl.lowerX.whip,
      freeArmWrist: t.freeArm.hurl.handX,
      readyArmUpperZ: t.readyArm.upperZ,
      armKeyRelease: t.armKeys.hurl.find(k => Math.abs(k.at - 0.58) < 0.001).upperX,
      whipBeatIn: t.throwBeats.hurl.whip[0],
      legTuckIn: t.hurlLegs.tuck[1],
      clearance: Number(window.__anim.freeArmClearance().toFixed(4)),
      exportHash: document.querySelector('#export').value.length,
    };
  })()
`);
const before = await snapshot();

// Drag one control in every section, through the real sliders.
const dragged = await ev(`
  (() => {
    const touched = [];
    const bump = (sectionText, beatText, controlName, value) => {
      const section = [...document.querySelectorAll('.anim-section')]
        .find(s => s.querySelector('h2').textContent.includes(sectionText));
      const group = [...section.querySelectorAll('.anim-beat, .anim-key')]
        .find(b => b.querySelector('h3').textContent.includes(beatText));
      const row = [...group.querySelectorAll('.anim-control')]
        .find(c => c.querySelector('span').textContent === controlName);
      const slider = row.querySelector('input[type=range]');
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      touched.push(sectionText + '/' + beatText + '/' + controlName);
    };
    bump('free arm', 'shoulder · up', 'base', 0.55);
    bump('free arm', 'elbow', 'whip', 1.1);
    bump('free arm', 'held', 'wrist', 0.9);
    bump('ready pose', 'free arm', 'upperZ', 0.8);
    bump('body beats', 'whip', 'in', 0.21);
    bump('leg beats', 'tuck', 'full', 0.31);
    return touched;
  })()
`);
await wait(600);
const edited = await snapshot();
await ev(`document.querySelector('#revert').click()`);
await wait(700);
const reverted = await snapshot();

const changed = Object.keys(before).filter((k) => before[k] !== edited[k]);
const notRestored = Object.keys(before).filter((k) => before[k] !== reverted[k]);
console.log(JSON.stringify({ dragged, changedByEditing: changed, stillWrongAfterRevert: notRestored,
  before, edited, reverted, status: await ev(`document.querySelector('#save-status').textContent`) }, null, 1));
socket.close();
