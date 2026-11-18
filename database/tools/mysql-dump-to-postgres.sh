#!/usr/bin/env bash
# =====================================================================
# แปลงไฟล์ dump ของ MySQL (เช่น backup จาก Railway) → ไฟล์ SQL สำหรับ Supabase
#
#   bash database/tools/mysql-dump-to-postgres.sh <ไฟล์-dump.sql> [ไฟล์ผลลัพธ์.sql]
#
# ไม่ใส่ไฟล์ผลลัพธ์ = เขียนข้าง ๆ ไฟล์ dump ชื่อเดิมต่อท้าย -postgres.sql
# ต้องเปิด Docker Desktop และ build image ของโปรเจกต์ไว้แล้ว (docker compose build web)
#
# ขั้นตอนที่สคริปต์ทำ:
#   1. เปิด MySQL 9.4 ชั่วคราว (ไม่แตะ MySQL บน Railway และไม่แตะ Docker ของเว็บ)
#   2. import ไฟล์ dump เข้าไป
#   3. ใช้ database/tools/mysql-to-postgres.php อ่านแล้วเขียนเป็น INSERT ของ Postgres
#   4. ลบ MySQL ชั่วคราวทิ้ง (ทั้งตอนสำเร็จและตอนพัง)
#
# ไฟล์ dump และไฟล์ผลลัพธ์มีข้อมูลลูกค้า — เก็บไว้นอก repo (เช่น D:\kpop-store-backups\)
# =====================================================================
set -euo pipefail

DUMP="${1:-}"
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "ใช้: bash $0 <ไฟล์-dump.sql> [ไฟล์ผลลัพธ์.sql]" >&2; exit 1; }
OUT="${2:-${DUMP%.sql}-postgres.sql}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "$(cd "$(dirname "$OUT")" && pwd)/" in
    "$ROOT"/*) echo "ปฏิเสธ: ไฟล์ผลลัพธ์อยู่ใน repo — มีข้อมูลลูกค้า ห้ามเสี่ยงหลุดขึ้น git" >&2; exit 1 ;;
esac

NAME="kpop-convert-mysql-$$"
NET="kpop-convert-net-$$"
IMAGE="$(cd "$ROOT" && docker compose config --images web 2>/dev/null | head -1)"
IMAGE="${IMAGE:-projectpreorder-web}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "ไม่พบ image $IMAGE — รัน docker compose build web ก่อน" >&2; exit 1; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1/3 เปิด MySQL ชั่วคราว..."
docker network create "$NET" >/dev/null
docker run -d --name "$NAME" --network "$NET" \
    -e MYSQL_ROOT_PASSWORD=convert -e MYSQL_DATABASE=src mysql:9.4 >/dev/null
for i in $(seq 1 60); do
    docker exec "$NAME" mysql -uroot -pconvert -e 'SELECT 1' src >/dev/null 2>&1 && break
    sleep 2
    [ "$i" = 60 ] && { echo "MySQL ชั่วคราวไม่ขึ้น" >&2; exit 1; }
done

echo "2/3 import ไฟล์ dump..."
docker exec -i "$NAME" mysql -uroot -pconvert --default-character-set=utf8mb4 src < "$DUMP" 2>/dev/null
# dump บางไฟล์มี USE <ชื่อ> ข้างใน (เช่นไฟล์ของ MAMP) ข้อมูลจะไปอยู่ฐานนั้นแทน src — หาฐานที่มีตาราง orders จริง
DB=$(docker exec "$NAME" mysql -uroot -pconvert -N -e \
    "SELECT table_schema FROM information_schema.tables WHERE table_name = 'orders'
     AND table_schema NOT IN ('mysql', 'sys', 'information_schema', 'performance_schema') LIMIT 1" 2>/dev/null)
[ -n "$DB" ] || { echo "ไม่พบตาราง orders ในไฟล์ dump — ใช่ไฟล์ backup ของร้านหรือเปล่า?" >&2; exit 1; }

echo "3/3 แปลงเป็น PostgreSQL (ฐาน $DB)..."
MSYS_NO_PATHCONV=1 docker run --rm --network "$NET" \
    -v "$ROOT/database/tools:/tools:ro" \
    -e MYSQL_URL="mysql://root:convert@$NAME:3306/$DB" \
    --entrypoint php "$IMAGE" /tools/mysql-to-postgres.php > "$OUT"

echo "เสร็จ → $OUT"
echo "ต่อไป: Supabase → SQL Editor → รัน database/schema.sql → แล้วรันไฟล์นี้"
