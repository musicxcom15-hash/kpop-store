import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// อ่านจาก env ให้ตรงกับที่ .env.example ประกาศไว้ (เดิมฮาร์ดโค้ด 3000 ทำให้ตั้งค่าไม่มีผล)
const PORT = Number(process.env.PORT) || 3000;

const staticDir = path.join(__dirname, 'preorderkpopweb');

// Serve static assets and HTML files
app.use(express.static(staticDir));

// คืน absolute path ที่ยืนยันแล้วว่าอยู่ใต้ staticDir จริง — ถ้าหลุดออกนอกให้คืน null
// จำเป็นเพราะ req.path มี '..' ได้ (เช่นส่งมาแบบ %2e%2e%2f) แล้ว path.join จะไต่ออกนอกโฟลเดอร์เว็บ
// ทำให้ res.sendFile ส่งไฟล์อย่าง package.json หรือไฟล์นอกโปรเจกต์ออกไปได้
function resolveInsideStatic(relativePath) {
    const resolved = path.resolve(staticDir, '.' + path.posix.normalize('/' + relativePath));
    const base = path.resolve(staticDir);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    return resolved;
}

// Fallback route for static page requests
app.get('*', (req, res) => {
    const indexFile = path.join(staticDir, 'index.html');

    if (!path.extname(req.path) && req.path !== '/') {
        const candidate = resolveInsideStatic(`${req.path}.html`);
        if (!candidate) return res.sendFile(indexFile);

        return res.sendFile(candidate, (err) => {
            if (err) return res.sendFile(indexFile);
        });
    }

    res.sendFile(indexFile);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
