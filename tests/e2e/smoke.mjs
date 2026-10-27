// Smoke test ทั้งเว็บผ่าน Chrome headless (Chrome DevTools Protocol) — เปิดทุกหน้า ล็อกอิน ตรวจสิทธิ์ และจอมือถือ
//
//   node tests/e2e/smoke.mjs http://localhost:8080
//
// ต้องมีเว็บรันอยู่ (docker compose / MAMP) และมี Chrome ในเครื่อง จึงไม่อยู่ใน `npm test`
// ไม่เขียนข้อมูลลง DB นอกจาก session ล็อกอิน (คำขอแอดมินที่ยิงทดสอบสิทธิ์ถูกปฏิเสธก่อนถึงขั้นเขียน)
//
// ค่าตั้งต้นคือบัญชีตัวอย่างใน database/kpop_store.sql — บนเว็บจริงให้ส่งบัญชีของจริงผ่าน env:
//   SMOKE_CUSTOMER_EMAIL / SMOKE_CUSTOMER_PASSWORD / SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD
//   SMOKE_SKIP_ADMIN=1   ข้ามส่วนแอดมิน   ·   CHROME_PATH=...   ถ้า Chrome ไม่ได้อยู่ที่ตำแหน่งปกติ
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const CUSTOMER = { email: process.env.SMOKE_CUSTOMER_EMAIL || 'user@kpopstore.com', password: process.env.SMOKE_CUSTOMER_PASSWORD || '123456' };
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL || 'admin@kpopstore.com', password: process.env.SMOKE_ADMIN_PASSWORD || 'admin123' };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PORT = 9400 + Math.floor(Math.random() * 100);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kpop-smoke-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let step = '';
const problems = [], dialogs = [], results = [];
setTimeout(() => { console.log('WATCHDOG ค้างที่', step); console.log(problems.join('\n')); chrome.kill(); process.exit(2); }, 300000).unref();

let targets;
for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch { }
    await sleep(250);
}
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map(); const listeners = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else [...listeners].forEach(fn => fn(m));
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
listeners.push(m => {
    if (m.method === 'Runtime.exceptionThrown') problems.push(`[${step}] JS exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`[${step}] console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`[${step}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(`[${step}] ${m.params.message}`); send('Page.handleJavaScriptDialog', { accept: true }); }
});
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');

const waitLoad = () => new Promise(r => { const fn = m => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(fn), 1); r(); } }; listeners.push(fn); });
async function evaluate(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'eval failed');
    return res.result?.result?.value;
}
// รอจน KpopStore.ready เสร็จ (รวมการลองซ้ำตอน DB เพิ่งตื่น) แล้วค่อยตรวจ
const settle = () => evaluate(`new Promise(r => (window.KpopStore ? KpopStore.ready(() => setTimeout(r, 400)) : setTimeout(r, 400)))`);
async function goto(p) { const l = waitLoad(); await send('Page.navigate', { url: BASE + '/' + p }); await Promise.race([l, sleep(20000)]); await settle(); }
const url = () => evaluate('location.pathname + location.search');
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
async function login(email, pass) {
    await goto('login.html');
    const l = waitLoad();
    await evaluate(`(() => { const e = document.getElementById('loginEmail'); e.value = ${JSON.stringify(email)};
        document.getElementById('loginPassword').value = ${JSON.stringify(pass)}; e.form.requestSubmit(); })()`);
    await Promise.race([l, sleep(20000)]); await sleep(300); await settle();
}

try {
    step = 'anon index'; await goto('index.html');
    const anon = await evaluate(`({ links: document.querySelectorAll('a[href*="product-detail.html?id="]').length, rate: KpopStore.getCurrentRate().rate,
        old: document.body.innerText.includes('ปิดรอบประจำวัน 22:00'), bar: !!document.getElementById('kpopLoadStatusBar') })`);
    check('หน้าแรกโหลดสินค้า (ไม่ล็อกอิน)', anon.links > 0, `${anon.links} ลิงก์สินค้า`);
    check('เรทราคากลาง = 0.028', anon.rate === 0.028, String(anon.rate));
    check('ไม่มีข้อความ 22:00 เดิม', !anon.old);
    check('ไม่มีแถบ "โหลดไม่สำเร็จ" ค้างอยู่', !anon.bar);

    step = 'anon gate'; await goto('order-history.html');
    const gate = await evaluate(`({ btn: !!document.querySelector('a[href="login.html"].btn'), orders: KpopStore.getOrders().filter(o => o.customerEmail).length })`);
    check('ประวัติสั่งซื้อ (ไม่ล็อกอิน) ให้กดเข้าสู่ระบบ ไม่เห็นอีเมลคนอื่น', gate.btn && gate.orders === 0, JSON.stringify(gate));

    step = 'wrong password'; const before = dialogs.length;
    await login(CUSTOMER.email, 'wrong-pass-' + Date.now());
    check('รหัสผิดถูกปฏิเสธ', (await url()).startsWith('/login.html') && dialogs.length > before, dialogs.at(-1));

    step = 'customer login'; await login(CUSTOMER.email, CUSTOMER.password);
    const cu = await evaluate('KpopStore.getCurrentUser()');
    check('ลูกค้าล็อกอินได้', cu && cu.role === 'customer', cu ? cu.name : CUSTOMER.email);

    step = 'product-detail';
    const pid = await evaluate('(KpopStore.getProducts()[0] || {}).id');
    await goto('product-detail.html?id=' + encodeURIComponent(pid));
    const pd = await evaluate(`({ text: document.body.innerText.length, price: document.getElementById('display-price').innerText, stars: !!document.querySelector('.fa-star') })`);
    check('หน้ารายละเอียดสินค้า (มีราคา ไม่มีดาวรีวิว)', pd.text > 200 && /^฿[\d,]+$/.test(pd.price) && !pd.stars, `${pid} ${pd.price}`);

    for (const p of ['cart.html', 'checkout.html', 'order-history.html']) {
        step = p; await goto(p);
        check(`ลูกค้าเปิด ${p}`, (await url()).startsWith('/' + p) || p === 'checkout.html', await url());
    }
    step = 'customer→admin'; await goto('admin.html');
    const g = await evaluate(`(async () => ({
        guard: getComputedStyle(document.getElementById('adminGuardContainer')).display !== 'none',
        main: getComputedStyle(document.getElementById('adminMainContainer')).display !== 'none',
        users: KpopStore.getUsers().length,
        other: KpopStore.getOrders().filter(o => o.customerEmail && o.customerEmail.toLowerCase() !== ${JSON.stringify(CUSTOMER.email.toLowerCase())}).length,
        a1: await KpopApi.post('users.php?action=save', { name: 'x', email: 'x@x.com', role: 'admin' }),
        a2: await KpopApi.post('orders.php?action=status', { orderId: 'ORD-NOT-REAL', statusCode: 'DELIVERED' }),
    }))()`);
    check('ลูกค้าเปิด admin.html เห็นแค่กล่องกันสิทธิ์', g.guard && !g.main);
    check('ลูกค้าเห็นรายชื่อผู้ใช้แค่ตัวเอง', g.users <= 1, String(g.users));
    check('ลูกค้าไม่เห็นอีเมลในออเดอร์คนอื่น', g.other === 0, String(g.other));
    check('API แอดมินปฏิเสธลูกค้า (users.php)', !g.a1.success, g.a1.message);
    check('API แอดมินปฏิเสธลูกค้า (เปลี่ยนสถานะ)', !g.a2.success, g.a2.message);
    await evaluate('KpopStore.clearSession()');

    if (!process.env.SMOKE_SKIP_ADMIN) {
        step = 'admin login'; await login(ADMIN.email, ADMIN.password);
        check('แอดมินล็อกอินแล้วไป admin.html', (await url()).startsWith('/admin.html'), await url());
        const tabs = await evaluate(`[...document.querySelectorAll('[id$="-tab"][data-bs-target]')].map(b => b.id)`);
        for (const t of tabs) {
            step = 'admin ' + t;
            await evaluate(`document.getElementById('${t}').click()`); await sleep(500);
            const info = await evaluate(`(() => { const pane = document.querySelector(document.getElementById('${t}').dataset.bsTarget);
                return { shown: pane.classList.contains('active'), text: pane.innerText.trim().length, rows: pane.querySelectorAll('tbody tr').length }; })()`);
            check(`แท็บแอดมิน ${t}`, info.shown && info.text > 0, `${info.rows} แถว`);
        }
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const p of ['index.html', 'admin.html', 'login.html', 'register.html']) {
        step = 'mobile ' + p; await goto(p);
        const w = await evaluate('document.documentElement.scrollWidth');
        check(`จอมือถือ 390px ไม่ล้น: ${p}`, w <= 390, `scrollWidth=${w}`);
    }
    await evaluate('KpopStore.clearSession()');
} catch (e) {
    problems.push(`[${step}] สคริปต์หยุด: ${e.message}`);
} finally {
    console.log(results.join('\n'));
    const fails = results.filter(r => r.startsWith('FAIL')).length;
    console.log(`\nสรุป: PASS ${results.length - fails} / FAIL ${fails}`);
    // 403 เกิดจากคำขอแอดมินที่ตั้งใจยิงด้วยบัญชีลูกค้า ไม่ใช่ปัญหา
    // (บนเครื่องขึ้น "403 (Forbidden)" แต่ผ่าน HTTP/2 ของ Railway ขึ้น "403 ()")
    const errs = problems.filter(p => !/status of 403 /.test(p));
    console.log('error ในเบราว์เซอร์: ' + (errs.length ? '\n' + errs.join('\n') : 'ไม่มี'));
    ws.close(); chrome.kill();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } process.exit(fails || errs.length ? 1 : 0); }, 500);
}
