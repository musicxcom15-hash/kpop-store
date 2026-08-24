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
exec docker-php-entrypoint "$@"
