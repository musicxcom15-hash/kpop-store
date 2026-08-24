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

# Apache บน Debian ยอมให้เปิด MPM ได้ "ทีละตัวเดียว" ถ้ามีสองตัวจะตายตอน start ด้วย
#   AH00534: apache2: Configuration error: More than one MPM loaded.
# และ mod_php (ซึ่ง image นี้ใช้รัน PHP) ทำงานได้กับ prefork เท่านั้น
# เดิมไฟล์นี้ปล่อยตามค่าที่ image ให้มาโดยไม่ได้ตรวจ — บังคับให้ชัดเจนไปเลยจะได้ไม่ต้องเดา
# รอบก่อนใช้ a2dismod/a2enmod แล้วเขียน `2>/dev/null || true` ต่อท้าย ซึ่งกลบทั้ง
# ข้อความ error และ exit code ถ้า a2dismod ไม่ได้ทำงานจริงก็ไม่มีทางรู้ แล้ว a2enmod
# ต่อท้ายก็ได้ MPM สองตัวเหมือนเดิม — คราวนี้จัดการ symlink ตรง ๆ ไม่ให้ล้มเหลวแบบเงียบ ๆ ได้
RUN set -eux; \
    rm -f /etc/apache2/mods-enabled/mpm_*.load /etc/apache2/mods-enabled/mpm_*.conf; \
    ln -sf ../mods-available/mpm_prefork.load /etc/apache2/mods-enabled/mpm_prefork.load; \
    ln -sf ../mods-available/mpm_prefork.conf /etc/apache2/mods-enabled/mpm_prefork.conf; \
    echo '=== LoadModule mpm ที่ประกาศอยู่ทั้ง /etc/apache2 ==='; \
    grep -RIn 'LoadModule .*mpm' /etc/apache2/ || true; \
    echo '=== mods-enabled ==='; \
    ls -l /etc/apache2/mods-enabled/ | grep -i mpm

# กัน warning AH00558 ที่ขึ้นทุกครั้งตอน start เพราะเดา FQDN ไม่ได้
# ไม่ใช่ error แต่ทำให้ log อ่านยากตอนไล่ปัญหาจริง
RUN printf 'ServerName localhost\n' > /etc/apache2/conf-available/zz-servername.conf \
    && a2enconf zz-servername

# ด่านสุดท้ายตอน build — ถ้า config ผิด (รวมถึง MPM ซ้ำ) ให้ build ล้มตรงนี้เลย
# ดีกว่าปล่อยผ่านแล้วไปตายตอน start ซึ่งเห็นแค่ AH00534 ลอย ๆ ใน deploy log
RUN apache2ctl -t

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
