FROM php:8.3-apache

# โค้ดใช้ never return type (8.1+), match (8.0+), str_starts_with (8.0+)
# และคุย MySQL ผ่าน PDO เท่านั้น
# opcache มีมากับ image แล้วแต่ยังไม่ถูกโหลด — ต้อง enable ก่อน ค่า opcache.* ด้านล่างถึงจะมีผล
RUN docker-php-ext-install pdo_mysql \
    && docker-php-ext-enable opcache

# Apache บน Debian ยอมให้เปิด MPM ได้ "ทีละตัวเดียว" ถ้ามีสองตัวจะตายตอน start ด้วย
#   AH00534: apache2: Configuration error: More than one MPM loaded.
# และ mod_php (ซึ่ง image นี้ใช้รัน PHP) ทำงานได้กับ prefork เท่านั้น
RUN set -eux; \
    rm -f /etc/apache2/mods-enabled/mpm_*.load /etc/apache2/mods-enabled/mpm_*.conf; \
    ln -sf ../mods-available/mpm_prefork.load /etc/apache2/mods-enabled/mpm_prefork.load; \
    ln -sf ../mods-available/mpm_prefork.conf /etc/apache2/mods-enabled/mpm_prefork.conf; \
    echo '=== LoadModule mpm ที่ประกาศอยู่ทั้ง /etc/apache2 ==='; \
    grep -RIn 'LoadModule .*mpm' /etc/apache2/ || true; \
    echo '=== mods-enabled ==='; \
    ls -l /etc/apache2/mods-enabled/ | grep -i mpm

# กัน warning AH00558 ที่ขึ้นทุกครั้งตอน start เพราะเดา FQDN ไม่ได้
RUN printf 'ServerName localhost\n' > /etc/apache2/conf-available/zz-servername.conf \
    && a2enconf zz-servername

# ด่านสุดท้ายตอน build — ถ้า config ผิด (รวมถึง MPM ซ้ำ) ให้ build ล้มตรงนี้เลย
RUN apache2ctl -t

# uploads/.htaccess เป็นด่านกันไม่ให้ Apache รันไฟล์ในโฟลเดอร์อัปโหลด
RUN printf '%s\n' \
    '<Directory /var/www/html>' \
    '    Options -Indexes +FollowSymLinks' \
    '    AllowOverride All' \
    '    Require all granted' \
    '</Directory>' \
    > /etc/apache2/conf-available/zz-kpop.conf \
    && a2enconf zz-kpop

# เพิ่มการตั้งค่า PHP และเปิดใช้งาน OPcache ตรงนี้
RUN printf '%s\n' \
    '; เวลาไทย — ทั้งระบบเก็บ/เทียบเวลาเป็น Asia/Bangkok (จุดตัดเรท 22:00)' \
    'date.timezone = Asia/Bangkok' \
    '' \
    '; ตั้งค่า OPcache เพื่อความเร็วในการรัน PHP' \
    'opcache.enable = 1' \
    'opcache.memory_consumption = 128' \
    'opcache.interned_strings_buffer = 8' \
    'opcache.max_accelerated_files = 4000' \
    'opcache.revalidate_freq = 2' \
    '' \
    '; upload.php รับรูปเป็น data URL ใน JSON body สูงสุด 8MB' \
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
RUN mkdir -p /opt/kpop \
    && cp /var/www/html/uploads/.htaccess /opt/kpop/uploads.htaccess

COPY docker-entrypoint.sh /usr/local/bin/kpop-entrypoint
RUN chmod +x /usr/local/bin/kpop-entrypoint

ENTRYPOINT ["/usr/local/bin/kpop-entrypoint"]

# entrypoint จะ exec คำสั่งนี้เป็นตัวสุดท้าย
CMD ["apache2-foreground"]