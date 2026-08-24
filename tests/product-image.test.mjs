import { loadStore, eq, report } from './harness.mjs';

console.log('\n[1] compressSlipImage ยังมีอยู่และลายเซ็นเดิมไม่เปลี่ยน');
{
  const { K } = loadStore();
  eq('มี compressImage', typeof K.compressImage, 'function');
  eq('มี compressSlipImage', typeof K.compressSlipImage, 'function');
  eq('มี compressProductImage', typeof K.compressProductImage, 'function');
  eq('compressSlipImage รับ (file, callback)', K.compressSlipImage.length, 2);
  eq('compressProductImage รับ (file, callback)', K.compressProductImage.length, 2);
  // ไฟล์ว่างต้องเรียก callback(null) ทันที ไม่ต้องพึ่ง FileReader
  let got = 'ยังไม่ถูกเรียก';
  K.compressSlipImage(null, v => { got = v; });
  eq('ไม่มีไฟล์ -> callback(null)', got, null);
}

console.log('\n[2] getStorageUsage นับเฉพาะคีย์ kpop_*');
{
  const { K, storage } = loadStore(null, { limitBytes: 1e9 });
  const before = K.getStorageUsage();
  eq('มี bytes/limit/percent ครบ',
     ['bytes', 'limit', 'percent'].every(k => typeof before[k] === 'number'), true);

  // เขียนลง Map ตรง ๆ เพื่อข้ามการตรวจโควตาของ setItem — ต้องการแค่คีย์แปลกปลอมไว้พิสูจน์ว่าไม่ถูกนับ
  storage._raw.set('ของคนอื่นไม่เกี่ยว', 'x'.repeat(50000));
  eq('ไม่นับคีย์ที่ไม่ใช่ kpop_', K.getStorageUsage().bytes, before.bytes);

  await K.saveProduct({ id: 'big', artist: 'X', title: 'รูปใหญ่', image: 'data:image/jpeg;base64,' + 'A'.repeat(40000) });
  eq('บันทึกรูปแล้วขนาดเพิ่ม', K.getStorageUsage().bytes > before.bytes, true);
  eq('percent ไม่เกิน 100', K.getStorageUsage().percent <= 100, true);
}

console.log('\n[3] saveProduct ต้องบอกว่าล้มเหลวเมื่อพื้นที่เต็ม (บั๊กสำคัญที่สุด)');
{
  const { K, storage } = loadStore(null, { limitBytes: 200000 });

  const ok = await K.saveProduct({ id: 'p1', artist: 'A', title: 'สินค้าปกติ', image: 'images/a.jpg' });
  eq('บันทึกปกติสำเร็จ', ok.success, true);
  eq('คืน products กลับมาด้วย', Array.isArray(ok.products), true);
  eq('ไม่มีข้อความ error', ok.message, '');

  storage._startEnforcingLimit();
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(500000);
  const failed = await K.saveProduct({ id: 'p2', artist: 'B', title: 'รูปใหญ่เกิน', image: huge });

  eq('พื้นที่เต็ม -> success = false', failed.success, false);
  eq('มีข้อความอธิบาย', failed.message.length > 0, true);
  eq('ข้อความแนะทางออก (ใช้ URL)', failed.message.includes('URL'), true);
  eq('ข้อมูลต้องไม่ถูกบันทึกจริง', K.getProductById('p2'), undefined);
  eq('สินค้าเดิมต้องไม่หาย', K.getProductById('p1').title, 'สินค้าปกติ');
}

console.log('\n[4] สินค้าที่บันทึกด้วยรูปอัปโหลด อ่านกลับมาได้ครบ');
{
  const { K } = loadStore();
  const dataUri = 'data:image/jpeg;base64,' + 'Z'.repeat(2000);
  const res = await K.saveProduct({
    id: 'up1', artist: 'aespa', title: 'สินค้ารูปอัปโหลด',
    priceKRW: 20000, serviceFee: 100, roundId: 'round-kr', quotaPerRound: 5, image: dataUri
  });
  eq('บันทึกสำเร็จ', res.success, true);
  eq('รูปถูกเก็บครบไม่ถูกตัด', K.getProductById('up1').image, dataUri);
  eq('ราคายังคำนวณได้ตามปกติ', K.getPriceTHB('up1'), Math.ceil(20000 * 0.0265) + 100);
}

report();
