#!/usr/bin/env bash
# =====================================================================
# ย้ายสลิป/รูปสินค้าที่อัปโหลดไว้บนเว็บเดิม (Railway) ขึ้น Supabase Storage
# แล้วแก้ path ในฐานข้อมูล Supabase ให้ชี้ที่ใหม่
#
#   export DATABASE_URL='postgresql://...'          # Supabase (Session pooler)
#   export SUPABASE_URL='https://<ref>.supabase.co'
#   export SUPABASE_SECRET_KEY='sb_secret_...'
#   export OLD_SITE_URL='https://web-production-6fbe4.up.railway.app'
#   bash database/tools/copy-uploads-to-storage.sh
#
# ค่าเหล่านี้เป็นความลับ — ส่งเข้า container ด้วยชื่อตัวแปรเท่านั้น ไม่โผล่ใน command line หรือ log
# ต้องรันหลัง import ข้อมูลเข้า Supabase แล้ว และตอนเว็บเดิมยังเปิดอยู่ · รันซ้ำได้
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="$(cd "$ROOT" && docker compose config --images web 2>/dev/null | head -1)"
IMAGE="${IMAGE:-projectpreorder-web}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "ไม่พบ image $IMAGE — รัน docker compose build web ก่อน" >&2; exit 1; }

for v in DATABASE_URL SUPABASE_URL SUPABASE_SECRET_KEY OLD_SITE_URL; do
    [ -n "${!v:-}" ] || { echo "ยังไม่ได้ export $v" >&2; exit 1; }
done

MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$ROOT:/app:ro" \
    -e DATABASE_URL -e SUPABASE_URL -e SUPABASE_SECRET_KEY -e SUPABASE_STORAGE_BUCKET -e OLD_SITE_URL \
    --entrypoint php "$IMAGE" /app/database/tools/copy-uploads-to-storage.php
