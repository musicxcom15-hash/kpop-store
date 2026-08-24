# =====================================================================
# KPOP STORE — image สำหรับ deploy บน Railway
#
# ทำไมต้องมีไฟล์นี้:
#   ที่รากโปรเจกต์มี package.json อยู่ Railway จึงเดาว่านี่คือ Node app
#   แล้วไปรัน server.js ซึ่งเสิร์ฟได้แค่ไฟล์ static — api/*.php จะถูกส่งกลับไป
#   เป็น text ทั้งไฟล์ เว็บเปิดได้แต่ล็อกอินไม่ได้ สินค้าไม่ขึ้น
#   ไฟล์นี้ (คู่กับ railway.json) บังคับให้ build เป็น PHP + Apache แทน
#
# docroot ตั้งเป็น /var/www/html โดยเอาเนื้อใน preorderkpopweb/ ไปวางตรง ๆ
# ให้เหมือนตอนตั้ง Document Root ใน MAMP เป๊ะ path ในโค้ด (api/, images/,
# uploads/) จึงใช้ต่อได้โดยไม่ต้องแก้แม้แต่บรรทัดเดียว
# =====================================================================
FROM php:8.3-apache

# โค้ดใช้ never return type (8.1+), match (8.0+), str_starts_with (8.0+)
# และคุย MySQL ผ่าน PDO เท่านั้น
RUN docker-php-ext-install pdo_mysql

# uploads/.htaccess เป็นด่านกันไม่ให้ Apache รันไฟล์ในโฟลเดอร์อัปโหลด
# image นี้ default เป็น AllowOverride None ซึ่งแปลว่า .htaccess ถูกมองข้ามทั้งไฟล์
RUN printf '%s\n' \
    '<Directory /var/www/html>' \
    '    Options -Indexes +FollowSymLinks' \
    '    AllowOverride All' \
    '    Require all granted' \
    '</Directory>' \
    > /etc/apache2/conf-available/zz-kpop.conf \
    && a2enconf zz-kpop

RUN printf '%s\n' \
    '; เวลาไทย — ทั้งระบบเก็บ/เทียบเวลาเป็น Asia/Bangkok (จุดตัดเรท 22:00)' \
    'date.timezone = Asia/Bangkok' \
    '' \
    '; upload.php รับรูปเป็น data URL ใน JSON body สูงสุด 8MB' \
    '; base64 ทำให้ขนาดที่ส่งจริงโตขึ้น ~33% ค่า default 2M จึงไม่พอ' \
    'post_max_size = 16M' \
    'upload_max_filesize = 16M' \
    'memory_limit = 128M' \
    '' \
    '; error ต้องไม่โผล่ปนกับ JSON ที่ส่งกลับไปให้เบราว์เซอร์' \
    'display_errors = Off' \
    'log_errors = On' \
    'error_log = /dev/stderr' \
    > /usr/local/etc/php/conf.d/zz-kpop.ini

COPY preorderkpopweb/ /var/www/html/

# Railway จะ mount volume ทับ /var/www/html/uploads ทั้งโฟลเดอร์
# ซึ่งบัง .htaccess ที่เพิ่ง COPY ไปด้วย — เก็บสำเนาไว้นอกจุด mount
# ให้ entrypoint เอาไปวางคืนตอน start
RUN mkdir -p /opt/kpop \
    && cp /var/www/html/uploads/.htaccess /opt/kpop/uploads.htaccess

COPY docker-entrypoint.sh /usr/local/bin/kpop-entrypoint
RUN chmod +x /usr/local/bin/kpop-entrypoint

ENTRYPOINT ["/usr/local/bin/kpop-entrypoint"]

# entrypoint จะ exec คำสั่งนี้เป็นตัวสุดท้าย
CMD ["apache2-foreground"]
