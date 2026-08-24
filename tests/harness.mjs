/**
 * ตัวช่วยสำหรับชุดทดสอบอัตโนมัติ
 *
 * store.js ถูกเขียนมาให้ทำงานในเบราว์เซอร์ จึงต้องมี localStorage, window และ document
 * ไฟล์นี้จำลองสิ่งเหล่านั้นขึ้นมาใน Node แล้วโหลด store.js "ตัวจริง" เข้าไปรัน
 * โค้ดที่ถูกทดสอบจึงเป็นไฟล์เดียวกับที่ผู้ใช้จริงโหลดในเบราว์เซอร์ ไม่ใช่ของจำลอง
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// อ้างตำแหน่งจากไฟล์นี้เอง เพื่อให้สั่งรันจากโฟลเดอร์ไหนก็ได้
const STORE_PATH = path.join(__dirname, '..', 'preorderkpopweb', 'js', 'store.js');
const UI_PATH = path.join(__dirname, '..', 'preorderkpopweb', 'js', 'ui.js');

/**
 * สร้าง localStorage จำลองที่ตรวจโควตาได้
 * @param {number|null} limitBytes เพดานพื้นที่ (null = ไม่จำกัด) ใช้ทดสอบกรณีพื้นที่เต็ม
 */
function createLocalStorage(limitBytes) {
    const data = new Map();
    let enforceLimit = false;
    let alwaysFail = false;

    return {
        get length() { return data.size; },
        key: i => [...data.keys()][i],
        getItem: k => (data.has(k) ? data.get(k) : null),
        removeItem: k => data.delete(k),
        setItem(k, v) {
            const value = String(v);

            if (alwaysFail) throw quotaError();

            if (enforceLimit && limitBytes != null) {
                let used = 0;
                for (const [key, val] of data) {
                    if (key !== k) used += key.length + val.length;
                }
                if (used + k.length + value.length > limitBytes) throw quotaError();
            }

            data.set(k, value);
        },

        // ควบคุมจากตัวเทสต์
        _startEnforcingLimit() { enforceLimit = true; },
        _startFailing() { alwaysFail = true; },
        _raw: data
    };
}

function quotaError() {
    const err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    return err;
}

/**
 * โหลด store.js เข้า sandbox ใหม่ (แต่ละเทสต์ได้ข้อมูลสะอาดของตัวเอง)
 *
 * @param {Array|null} seedOrders ออเดอร์ตั้งต้น ใช้ทดสอบ migration ของข้อมูลเก่า
 * @param {object} options { limitBytes } เพดานพื้นที่สำหรับทดสอบกรณีเต็ม
 * @returns {{ K: object, raw: Function, storage: object }}
 *   K = KpopStore · raw() = อ่าน kpop_orders ดิบ · storage = คุม localStorage จำลอง
 */
export function loadStore(seedOrders, options = {}) {
    const localStorage = createLocalStorage(options.limitBytes ?? null);

    // ใส่ข้อมูลก่อนโหลด store.js เพื่อให้ initStore() เห็นและ migrate ให้
    if (seedOrders) localStorage.setItem('kpop_orders', JSON.stringify(seedOrders));

    const sandbox = {
        localStorage,
        console,
        // store.js แตะ DOM แค่ตอนผูก event และวาด navbar ซึ่งไม่เกี่ยวกับ logic ที่ทดสอบ
        document: {
            addEventListener() {},
            querySelector: () => null,
            getElementById: () => null
        },
        Date, JSON, Object, Array, Number, String, Math,
        isFinite, parseInt, parseFloat,
        alert() {}
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(STORE_PATH, 'utf8'), sandbox);

    return {
        K: sandbox.KpopStore,
        raw: () => JSON.parse(localStorage.getItem('kpop_orders')),
        storage: localStorage
    };
}

/**
 * โหลด store.js + ui.js เข้า sandbox เดียวกัน สำหรับทดสอบกำแพงล็อกอิน
 *
 * ui.js เป็นชั้นที่แตะ alert() และ window.location จริง จึงต้องจำลองสองอย่างนี้
 * แบบดักค่าไว้ได้ เพื่อตรวจว่า "เด้งไปที่ไหน" และ "เตือนว่าอะไร"
 *
 * @param {object} options { pathname, search } URL ของหน้าที่กำลังจำลองอยู่
 * @returns {{ K, alerts, navigations, storage }}
 *   navigations = รายการ URL ที่ถูกสั่งให้เปลี่ยนหน้า เรียงตามลำดับ
 */
export function loadUi(options = {}) {
    const localStorage = createLocalStorage(null);
    const alerts = [];
    const navigations = [];

    const location = {
        pathname: options.pathname ?? '/product-detail.html',
        search: options.search ?? ''
    };
    // ดัก `window.location.href = ...` ไว้แทนที่จะเปลี่ยนหน้าจริง
    Object.defineProperty(location, 'href', {
        get: () => location.pathname + location.search,
        set: url => navigations.push(url)
    });

    const noop = () => {};
    const sandbox = {
        localStorage, console, location,
        document: {
            addEventListener: noop,
            querySelector: () => null,
            getElementById: () => null,
            body: { insertAdjacentHTML: noop },
            head: { appendChild: noop },
            createElement: () => ({})
        },
        Date, JSON, Object, Array, Number, String, Math, RegExp,
        URLSearchParams, isFinite, parseInt, parseFloat,
        encodeURIComponent, decodeURIComponent,
        alert: msg => alerts.push(String(msg))
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(STORE_PATH, 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(UI_PATH, 'utf8'), sandbox);

    return { K: sandbox.KpopStore, alerts, navigations, storage: localStorage };
}

/* ---------- การนับผล ---------- */

let pass = 0;
let fail = 0;

/**
 * เทียบค่าที่ได้กับค่าที่ควรได้ (เทียบผ่าน JSON จึงเทียบ object/array ได้ด้วย)
 */
export function eq(label, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) {
        pass++;
        console.log('  ok   ' + label);
    } else {
        fail++;
        console.log('  FAIL ' + label +
            '\n         ได้    ' + JSON.stringify(got) +
            '\n         ควรได้ ' + JSON.stringify(want));
    }
}

export function section(title) {
    console.log('\n' + title);
}

/**
 * สรุปผลแล้วจบ process ด้วย exit code
 * (run-all.mjs แยกรันทีละ process จึงอ่าน exit code นี้ไปรวมได้)
 */
export function report() {
    console.log(`\n${pass} ผ่าน, ${fail} ไม่ผ่าน`);
    process.exit(fail ? 1 : 0);
}
