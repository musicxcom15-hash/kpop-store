import { loadStore, eq, report } from './harness.mjs';

console.log('\n[1] สินค้าที่ไม่มีหมวด (ข้อมูลก่อนมีหมวดหมู่) นับเป็นอัลบั้ม');
{
  const { K } = loadStore();
  const p = K.getProducts()[0];
  eq('ไม่มี category ในข้อมูลตั้งต้น', p.category, undefined);
  eq('ได้รหัส album', K.getProductCategory(p).code, 'album');
  eq('ชื่อไทย', K.getProductCategory(p).label, 'อัลบั้ม');
  eq('รับ id ได้เหมือน object', K.getProductCategory(p.id).code, 'album');
}

console.log('\n[2] หมวดที่ไม่รู้จัก ไม่ทำให้พัง — กลับไปเป็นอัลบั้ม');
{
  const { K } = loadStore();
  eq('รหัสมั่ว', K.getProductCategory({ category: 'hacker' }).code, 'album');
  eq('สินค้าไม่มีอยู่จริง', K.getProductCategory('no-such-id').code, 'album');
}

console.log('\n[3] ป้ายนับชาร์ตตัดสินด้วย flag — มีแค่อัลบั้มที่นับ');
{
  const { K } = loadStore();
  eq('อัลบั้มนับชาร์ต', K.getProductCategory({ category: 'album' }).chart, true);
  eq('แท่งไฟไม่นับ', K.getProductCategory({ category: 'lightstick' }).chart, false);
  eq('โฟโต้การ์ดไม่นับ', K.getProductCategory({ category: 'photocard' }).chart, false);
  eq('สินค้าอื่นไม่นับ', K.getProductCategory({ category: 'merch' }).chart, false);
  // รหัสต้องตรงกับ PRODUCT_CATEGORIES ใน api/helpers.php ที่ PHP ใช้ตรวจตอนบันทึก
  eq('รหัสครบ 4 หมวด', Object.keys(K.PRODUCT_CATEGORIES).join(','), 'album,lightstick,photocard,merch');
}

console.log('\n[4] บันทึกสินค้าพร้อมหมวดแล้วอ่านกลับได้ (โหมด localStorage)');
{
  const { K } = loadStore();
  const p = { ...K.getProducts()[0], id: 'ls-01', title: 'Official Lightstick', category: 'lightstick' };
  const res = await K.saveProduct(p);
  eq('บันทึกสำเร็จ', res.success, true);
  eq('อ่านกลับเป็นแท่งไฟ', K.getProductCategory('ls-01').code, 'lightstick');
}

report();
