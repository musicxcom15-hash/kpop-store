import { loadStore, eq, report } from './harness.mjs';

// เสื้อ 3 ไซซ์ ใช้รอบเดียวกับ bts (รอบที่เปิดอยู่) โควตารวม 5 ตัวทุกไซซ์
async function withTee(K, extra = {}) {
  const bts = K.getProductById('bts');
  await K.saveProduct({ ...bts, id: 'tee', title: 'Logo Tee', category: 'clothing',
    sizes: ['S', 'M', 'L'], quotaPerRound: 5, ...extra });
}

console.log('\n[1] สินค้าไม่มีไซซ์ ทำงานเหมือนเดิม');
{
  const { K } = loadStore();
  eq('ไม่มีไซซ์', K.getProductSizes('bts').length, 0);
  eq('size ว่างใช้ได้', K.isValidSize('bts', ''), true);
  eq('ส่งไซซ์มาให้สินค้าไม่มีไซซ์ = ไม่ถูกต้อง', K.isValidSize('bts', 'M'), false);
  eq('ใส่ตะกร้าโดยไม่ระบุไซซ์ได้', (await K.addToCart('bts', 1)).success, true);
  eq('บรรทัดในตะกร้ามี size ว่าง', K.getCart()[0].size, '');
}

console.log('\n[2] สินค้ามีไซซ์ ต้องเลือกไซซ์ที่มีอยู่จริง');
{
  const { K } = loadStore();
  await withTee(K);
  eq('ไม่เลือกไซซ์ ถูกปฏิเสธ', (await K.addToCart('tee', 1)).success, false);
  eq('ไซซ์ที่ไม่มี ถูกปฏิเสธ', (await K.addToCart('tee', 1, 'XXL')).success, false);
  eq('ไซซ์ M ผ่าน', (await K.addToCart('tee', 1, 'M')).success, true);
}

console.log('\n[3] คนละไซซ์อยู่คนละบรรทัด ไซซ์เดียวกันรวมกัน');
{
  const { K } = loadStore();
  await withTee(K);
  await K.addToCart('tee', 1, 'M');
  await K.addToCart('tee', 1, 'L');
  await K.addToCart('tee', 1, 'M');
  const lines = K.getCart().map(c => `${c.size}:${c.qty}`).sort().join(',');
  eq('M 2 ตัว L 1 ตัว', lines, 'L:1,M:2');

  await K.updateCartQty('tee', 1, 'M');
  eq('แก้จำนวนเฉพาะไซซ์ M', K.getCart().map(c => `${c.size}:${c.qty}`).sort().join(','), 'L:1,M:1');

  await K.removeFromCart('tee', 'L');
  eq('ลบเฉพาะไซซ์ L', K.getCart().map(c => c.size).join(','), 'M');
}

console.log('\n[4] โควตานับรวมทุกไซซ์');
{
  const { K } = loadStore();
  await withTee(K);
  eq('M 3 ตัว', (await K.addToCart('tee', 3, 'M')).qty, 3);
  const r = await K.addToCart('tee', 5, 'L');
  eq('L ได้แค่ 2 (5 - 3)', r.qty, 2);
  eq('แจ้งว่าถูกปรับ', r.adjusted, true);
  eq('ไซซ์ S เพิ่มไม่ได้แล้ว', (await K.addToCart('tee', 1, 'S')).success, false);

  const u = await K.updateCartQty('tee', 9, 'M');
  eq('แก้ M เป็น 9 ได้แค่ 3 (5 - L 2)', u.qty, 3);
}

console.log('\n[5] ตะกร้าเตือนเมื่อรวมทุกไซซ์เกินโควตา หรือไซซ์ถูกลบไปแล้ว');
{
  const { K } = loadStore();
  await withTee(K, { quotaPerRound: null });
  await K.addToCart('tee', 3, 'M');
  await K.addToCart('tee', 3, 'L');
  await K.saveProduct({ id: 'tee', quotaPerRound: 5 });
  let g = K.getCartGroupedByRound().groups[0];
  eq('รวม 6 > 5 → ทุกบรรทัดของเสื้อเกินโควตา', g.items.every(i => i.overQuota), true);
  eq('สั่งไม่ได้', g.orderable, false);

  await K.saveProduct({ id: 'tee', quotaPerRound: null, sizes: ['S', 'M'] });
  g = K.getCartGroupedByRound().groups[0];
  eq('L ถูกลบ → บรรทัด L ไม่ถูกต้อง', g.items.find(i => i.size === 'L').invalidSize, true);
  eq('M ยังถูกต้อง', g.items.find(i => i.size === 'M').invalidSize, false);
  eq('สั่งไม่ได้จนกว่าจะลบ L', g.orderable, false);
}

console.log('\n[6] ออเดอร์เก็บไซซ์ และสรุปยอดสั่งแยกไซซ์');
{
  const { K } = loadStore();
  await withTee(K, { quotaPerRound: null });
  const items = [{ id: 'tee', qty: 2, size: 'M' }, { id: 'tee', qty: 1, size: 'L' }];
  const res = await K.addOrder({ customerName: 'ทดสอบ', customerEmail: 'a@b.c', items, slipImage: 'x', shippingFee: 50 });
  eq('สร้างออเดอร์ได้', res.success, true);
  eq('ไซซ์ติดไปกับรายการ', res.order.items.map(i => i.size).join(','), 'M,L');

  const sum = K.getRoundSummary(res.order.roundId).items.filter(i => i.id === 'tee');
  eq('สรุปยอดแยก 2 บรรทัด เรียงตามไซซ์', sum.map(i => `${i.size}:${i.qty}`).join(','), 'M:2,L:1');
}

console.log('\n[7] ชื่อสินค้าพร้อมไซซ์');
{
  const { K } = loadStore();
  eq('มีไซซ์', K.formatItemName('Logo Tee', 'M'), 'Logo Tee · ไซซ์ M');
  eq('ไม่มีไซซ์', K.formatItemName('Album', ''), 'Album');
}

report();
