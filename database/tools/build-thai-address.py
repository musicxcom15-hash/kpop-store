"""
สร้างไฟล์ preorderkpopweb/data/thai-address.json (ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ทั้งประเทศ)

  npm pack thai-address-database        # ได้ไฟล์ .tgz (ทำในโฟลเดอร์ชั่วคราวนอก repo)
  tar -xzf thai-address-database-*.tgz
  python database/tools/build-thai-address.py package/database/db.json preorderkpopweb/data/thai-address.json

แหล่งข้อมูล: thai-address-database (สัญญาอนุญาต ISC) https://github.com/Sellsuki/thai-address-database
อ่านแค่ไฟล์ข้อมูล db.json — ไม่รันโค้ดของแพ็กเกจ (วิธีคลายข้อมูลเขียนตาม lib/index.js ของแพ็กเกจ)

รูปแบบไฟล์ผลลัพธ์ (ย่อให้เล็ก ใช้ร่วมกันทั้งหน้าเว็บ ui.js และ PHP helpers.php):
  p = [ชื่อจังหวัด, ...]
  a = [[ชื่ออำเภอ/เขต, ลำดับจังหวัดใน p], ...]
  z = { "รหัสไปรษณีย์": [[ชื่อตำบล/แขวง, ลำดับอำเภอใน a], ...], ... }
"""
import json
import re
import sys

src, out = sys.argv[1], sys.argv[2]
db = json.load(open(src, encoding='utf-8'))

# ข้อความในไฟล์ถูกบีบด้วยตารางคำ: ตัวเลข = ลำดับใน lookup · ตัวอักษร A-Z a-z = ลำดับใน words
lookup = db['lookup'].split('|')
words = db['words'].split('|')


def expand(x):
    if isinstance(x, int):
        x = lookup[x]
    return re.sub(r'[A-Za-z]', lambda m: words[ord(m.group(0)) - 65 if ord(m.group(0)) < 97 else 26 + ord(m.group(0)) - 97], x)


# โครงสร้างต้นทาง: [[จังหวัด, [[อำเภอ, [[ตำบล, รหัสไปรษณีย์ หรือ [หลายรหัส]], ...]], ...]], ...]
rows = []
for prov in db['data']:
    for amp in prov[1]:
        for dist in amp[1]:
            zips = dist[1] if isinstance(dist[1], list) else [dist[1]]
            for z in zips:
                rows.append((expand(dist[0]), expand(amp[0]), expand(prov[0]), str(z)))

provinces = sorted({r[2] for r in rows})
p_index = {p: i for i, p in enumerate(provinces)}
amphoes = sorted({(r[1], r[2]) for r in rows})
a_index = {a: i for i, a in enumerate(amphoes)}

by_zip = {}
for district, amphoe, province, zipcode in rows:
    by_zip.setdefault(zipcode, []).append([district, a_index[(amphoe, province)]])
for k in by_zip:
    by_zip[k].sort()

doc = {
    '_source': 'thai-address-database (ISC) — https://github.com/Sellsuki/thai-address-database — แปลงด้วย database/tools/build-thai-address.py',
    'p': provinces,
    'a': [[a, p_index[p]] for a, p in amphoes],
    'z': dict(sorted(by_zip.items())),
}
open(out, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
print(f'ตำบล {len(rows)}, อำเภอ {len(amphoes)}, จังหวัด {len(provinces)}, รหัสไปรษณีย์ {len(by_zip)}')
