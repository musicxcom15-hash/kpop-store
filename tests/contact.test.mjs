// ทดสอบการตรวจเบอร์โทรและที่อยู่ฝั่งหน้าเว็บ (ต้องให้ผลตรงกับ normalize_thai_phone / compose_address ใน api/helpers.php)
// รันเดี่ยว: node tests/contact.test.mjs · รันทั้งหมด: npm test
import { loadStore, eq, report } from './harness.mjs';

console.log('\n[1] เบอร์โทรที่ถูกต้อง → จัดรูปแบบมาตรฐาน');
{
  const { K } = loadStore();
  eq('มือถือมีขีด', K.normalizePhone('081-234-5678'), '081-234-5678');
  eq('มือถือติดกัน', K.normalizePhone('0812345678'), '081-234-5678');
  eq('มีช่องว่าง', K.normalizePhone(' 09 1234 5678 '), '091-234-5678');
  eq('รูปแบบสากล +66', K.normalizePhone('+66 81 234 5678'), '081-234-5678');
  eq('66 ไม่มี +', K.normalizePhone('66912345678'), '091-234-5678');
  eq('ขึ้นต้น 06', K.normalizePhone('0612345678'), '061-234-5678');
  eq('เบอร์บ้านกรุงเทพฯ', K.normalizePhone('02-123-4567'), '02-123-4567');
  eq('เบอร์บ้านต่างจังหวัด', K.normalizePhone('053123456'), '053-123-456');
}

console.log('\n[2] เบอร์ที่เป็นไปไม่ได้ → null');
{
  const { K } = loadStore();
  for (const bad of ['', '12345', '081234567', '08123456789', '0712345678', '0112345678',
                     '0000000000', '0999999999', '0123456789', '081-234-567x', '091234567', 'abc']) {
    eq(`ปฏิเสธ "${bad}"`, K.normalizePhone(bad), null);
  }
}

console.log('\n[3] ประกอบที่อยู่เต็ม');
{
  const { K } = loadStore();
  eq('กรุงเทพฯ ใช้ แขวง/เขต', K.composeAddress({ addressLine: '123/45 ซ.สุขุมวิท 1', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postcode: '10110' }),
     '123/45 ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110');
  eq('จังหวัดอื่นใช้ ต./อ./จ.', K.composeAddress({ addressLine: '9 ถ.นิมมานเหมินท์', subdistrict: 'สุเทพ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postcode: '50200' }),
     '9 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200');
}

console.log('\n[4] ข้อมูลติดต่อครบสำหรับสั่งซื้อหรือยัง');
{
  const { K } = loadStore();
  eq('เบอร์ถูก + มีรหัสไปรษณีย์', K.isContactComplete({ phone: '0812345678', postcode: '10110' }), true);
  eq('บัญชีเก่า: มีแต่ที่อยู่แบบพิมพ์ยาว', K.isContactComplete({ phone: '0812345678', address: 'กทม.', postcode: '' }), false);
  eq('เบอร์มั่ว', K.isContactComplete({ phone: '12345', postcode: '10110' }), false);
  eq('ไม่ได้ล็อกอิน', K.isContactComplete(null), false);
}

report();
