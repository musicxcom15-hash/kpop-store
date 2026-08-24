/**
 * รันไฟล์เทสต์ทุกไฟล์แล้วสรุปผลรวม
 *
 * ต้องแยกรันทีละ process เพราะ report() ใน harness.mjs เรียก process.exit()
 * ถ้า import เข้ามารวมกัน ไฟล์แรกที่จบจะฆ่าทั้ง runner ไฟล์ที่เหลือไม่ได้รัน
 */

import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// เรียงจากพื้นฐานไปซับซ้อน เวลาแดงจะได้เห็นต้นเหตุก่อนปลายเหตุ
const FILES = [
    'order-status.test.mjs',
    'rounds-rates-quota.test.mjs',
    'refund-flow.test.mjs',
    'product-image.test.mjs',
    'delete-order.test.mjs',
    'save-failure.test.mjs',
    'admin-product.test.mjs',
    'auth-gate.test.mjs'
];

const failed = [];

for (const file of FILES) {
    console.log('\n' + '='.repeat(60));
    console.log('▶ ' + file);
    console.log('='.repeat(60));

    // process.execPath = node ตัวที่กำลังรันอยู่ · stdio inherit ให้ผลไหลออกมาสด ๆ
    const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    if (res.status !== 0) failed.push(file);
}

console.log('\n' + '='.repeat(60));
if (failed.length === 0) {
    console.log(`✅ ผ่านครบทั้ง ${FILES.length} ไฟล์`);
} else {
    console.log(`❌ ไม่ผ่าน ${failed.length} จาก ${FILES.length} ไฟล์:`);
    failed.forEach(f => console.log('   - ' + f));
}
console.log('='.repeat(60));

// สำคัญ: ต้องคืน exit code ที่ถูกต้อง ไม่งั้น npm test จะขึ้นว่าสำเร็จทั้งที่เทสต์แดง
process.exit(failed.length ? 1 : 0);
