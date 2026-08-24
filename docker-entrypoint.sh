#!/bin/sh
# =====================================================================
# เตรียมคอนเทนเนอร์ก่อนปล่อย Apache ทำงาน
# =====================================================================
set -e

# --- 1. พอร์ต ------------------------------------------------------
# Railway ฉีด $PORT มาให้และคาดว่าแอปจะฟังที่พอร์ตนั้น
# แต่ Apache ฮาร์ดโค้ด 80 ไว้ในไฟล์ตั้งค่า จึงต้องเขียนทับตอน start
PORT="${PORT:-80}"
sed -ri "s/^Listen [0-9]+/Listen ${PORT}/" /etc/apache2/ports.conf
sed -ri "s/<VirtualHost \*:[0-9]+>/<VirtualHost *:${PORT}>/" \
    /etc/apache2/sites-available/000-default.conf

# --- 2. โฟลเดอร์อัปโหลด --------------------------------------------
# ถ้ามี volume mount ทับอยู่ โฟลเดอร์นี้จะว่างเปล่าในการ deploy ครั้งแรก
# และ .htaccess ที่ใส่มาใน image จะถูกบังหายไป — ต้องวางคืนเอง
# ไม่งั้นสลิปโอนเงินของลูกค้าจะถูกไล่เปิดดูได้จาก URL ตรง ๆ
mkdir -p /var/www/html/uploads
if [ ! -f /var/www/html/uploads/.htaccess ]; then
    cp /opt/kpop/uploads.htaccess /var/www/html/uploads/.htaccess
fi
chown -R www-data:www-data /var/www/html/uploads

# ส่งต่อให้ entrypoint ของ image ฐาน (มันจะ exec คำสั่งใน CMD คือ apache2-foreground)
# ห้ามเรียก apache2-foreground ตรง ๆ พร้อม "$@" เพราะ CMD ที่สืบทอดมาคือคำสั่งนั้นอยู่แล้ว
# จะกลายเป็น `apache2-foreground apache2-foreground` แล้ว Apache จะตายเพราะอาร์กิวเมนต์เกิน
# --- บังคับให้เหลือ MPM ตัวเดียว -------------------------------------
# ต้องทำตรงนี้ ไม่ใช่แค่ตอน build: ตรวจแล้วพบว่า mpm_event.load/.conf ของ
# base image รอดมาถึง runtime ได้ ทั้งที่ Dockerfile ลบทิ้งและ apache2ctl -t
# ผ่านตอน build (มี layer เอากลับมาหลังด่านตรวจ) ผลคือ Apache ตายด้วย
#   AH00534: apache2: Configuration error: More than one MPM loaded.
# จุดนี้คือคำสั่งสุดท้ายก่อน Apache รัน จึงเป็นที่เดียวที่การันตีผลได้จริง
# mod_php ใช้ได้กับ prefork เท่านั้น
rm -f /etc/apache2/mods-enabled/mpm_event.* /etc/apache2/mods-enabled/mpm_worker.*
ln -sf ../mods-available/mpm_prefork.load /etc/apache2/mods-enabled/mpm_prefork.load
ln -sf ../mods-available/mpm_prefork.conf /etc/apache2/mods-enabled/mpm_prefork.conf

# ถ้า config ยังผิดอยู่ ให้ตายพร้อมเหตุผลที่อ่านออก ดีกว่า restart วนเงียบ ๆ
if ! apache2ctl -t; then
    echo "!! config ของ Apache ยังผิด — MPM ที่เปิดอยู่ตอนนี้:" >&2
    ls -l /etc/apache2/mods-enabled/ | grep -i mpm >&2 || true
    exit 1
fi

exec docker-php-entrypoint "$@"
