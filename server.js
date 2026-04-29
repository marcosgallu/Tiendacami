// ─────────────────────────────────────────────────────────────
//  TIENDACAMI — Catálogo sin carrito
//  Ejecutar:  node server.js
//  Abre en:   http://localhost:3000
// ─────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const Database = require('better-sqlite3');

const app  = express();
const PORT = 3000;

// ── Carpeta de uploads ─────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Multer: guardar imágenes en /uploads ───────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB máx
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.webp','.gif'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (jpg, png, webp, gif)'));
  },
});

// ── Middlewares ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR)); // sirve las fotos

// ── Base de datos ──────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'db', 'catalogo.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    cat         TEXT    NOT NULL DEFAULT 'General',
    description TEXT    DEFAULT '',
    price       REAL    NOT NULL,
    old_price   REAL,
    sizes       TEXT    DEFAULT '',
    colors      TEXT    DEFAULT '',
    stock       INTEGER DEFAULT 0,
    image       TEXT    DEFAULT '',
    badge       TEXT    DEFAULT '',
    featured    INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );
`);

// Seed de ejemplo si está vacía
const count = db.prepare('SELECT COUNT(*) as n FROM products').get();
if (count.n === 0) {
  const ins = db.prepare(`
    INSERT INTO products (name, cat, description, price, old_price, sizes, colors, stock, badge, featured)
    VALUES (@name,@cat,@description,@price,@old_price,@sizes,@colors,@stock,@badge,@featured)
  `);
  db.transaction(rows => rows.forEach(r => ins.run(r)))([
    { name:'Vestido floral',   cat:'Mujer',      description:'Vestido liviano ideal para el verano.',    price:7990, old_price:12990, sizes:'XS,S,M,L',    colors:'Rosa,Blanco',  stock:8,  badge:'Oferta',  featured:1 },
    { name:'Buzo oversized',   cat:'Mujer',      description:'Buzo amplio con capucha, muy cómodo.',     price:5490, old_price:null,  sizes:'S,M,L,XL',    colors:'Gris,Negro',   stock:12, badge:'Nuevo',   featured:0 },
    { name:'Jean recto',       cat:'Hombre',     description:'Jean clásico de corte recto.',              price:8990, old_price:10990, sizes:'30,32,34,36',  colors:'Azul,Negro',   stock:6,  badge:'',        featured:1 },
    { name:'Remera básica',    cat:'Hombre',     description:'Remera 100% algodón, varios colores.',      price:3290, old_price:null,  sizes:'S,M,L,XL,XXL',colors:'Blanco,Negro', stock:20, badge:'',        featured:0 },
    { name:'Vestido niña',     cat:'Niños',      description:'Vestido con moño, ideal para ocasiones.',   price:3490, old_price:4990,  sizes:'4,6,8,10,12', colors:'Rosa,Lila',    stock:5,  badge:'Oferta',  featured:0 },
    { name:'Mochila cuero',    cat:'Accesorios', description:'Mochila urbana de cuero ecológico.',        price:15900,old_price:21000, sizes:'',            colors:'Negro,Camel',  stock:4,  badge:'Oferta',  featured:1 },
    { name:'Campera denim',    cat:'Mujer',      description:'Campera de jean con botones dorados.',      price:9990, old_price:13990, sizes:'XS,S,M,L,XL', colors:'Celeste',      stock:7,  badge:'Nuevo',   featured:0 },
    { name:'Short cargo',      cat:'Hombre',     description:'Short cargo con bolsillos laterales.',      price:4290, old_price:null,  sizes:'S,M,L,XL',    colors:'Beige,Verde',  stock:10, badge:'',        featured:0 },
  ]);
  console.log('✅ Productos de ejemplo cargados');
}

// ── Helper: parsear producto ───────────────────────────────────
function parseProduct(p) {
  return {
    ...p,
    sizes:  p.sizes  ? p.sizes.split(',').filter(Boolean)  : [],
    colors: p.colors ? p.colors.split(',').filter(Boolean) : [],
    featured: !!p.featured,
    image: p.image ? `/uploads/${p.image}` : '',
  };
}

// ══════════════════════════════════════════════════════════════
//  API — CATÁLOGO (solo lectura)
// ══════════════════════════════════════════════════════════════

// GET /api/products?cat=Mujer&q=vestido&featured=1
app.get('/api/products', (req, res) => {
  const { cat, q, featured } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (cat && cat !== 'Todo') { sql += ' AND cat = ?';                          params.push(cat); }
  if (q)                     { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (featured === '1')      { sql += ' AND featured = 1'; }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(parseProduct));
});

// GET /api/products/:id
app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json(parseProduct(row));
});

// GET /api/categories
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT cat FROM products ORDER BY cat').all();
  res.json(rows.map(r => r.cat));
});

// ══════════════════════════════════════════════════════════════
//  API — PANEL ADMIN (sin autenticación — uso interno)
// ══════════════════════════════════════════════════════════════

// POST /api/admin/products  — crear con imagen opcional
app.post('/api/admin/products', upload.single('image'), (req, res) => {
  const { name, cat, description, price, old_price, sizes, colors, stock, badge, featured } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });

  const imgName = req.file ? req.file.filename : '';
  const info = db.prepare(`
    INSERT INTO products (name, cat, description, price, old_price, sizes, colors, stock, image, badge, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    cat || 'General',
    description || '',
    parseFloat(price),
    old_price ? parseFloat(old_price) : null,
    sizes  || '',
    colors || '',
    parseInt(stock) || 0,
    imgName,
    badge || '',
    featured === '1' || featured === true ? 1 : 0
  );
  res.status(201).json(parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid)));
});

// PUT /api/admin/products/:id  — editar con imagen opcional
app.put('/api/admin/products/:id', upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No encontrado' });

  const { name, cat, description, price, old_price, sizes, colors, stock, badge, featured } = req.body;

  // Si subieron nueva imagen, borrar la vieja
  let imgName = existing.image;
  if (req.file) {
    if (imgName) {
      const oldPath = path.join(UPLOADS_DIR, imgName);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    imgName = req.file.filename;
  }

  db.prepare(`
    UPDATE products SET
      name=?, cat=?, description=?, price=?, old_price=?,
      sizes=?, colors=?, stock=?, image=?, badge=?, featured=?
    WHERE id=?
  `).run(
    name        ?? existing.name,
    cat         ?? existing.cat,
    description ?? existing.description,
    price       ? parseFloat(price) : existing.price,
    old_price   ? parseFloat(old_price) : existing.old_price,
    sizes       ?? existing.sizes,
    colors      ?? existing.colors,
    stock       ? parseInt(stock) : existing.stock,
    imgName,
    badge       ?? existing.badge,
    featured !== undefined ? (featured === '1' || featured === true ? 1 : 0) : existing.featured,
    req.params.id
  );
  res.json(parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)));
});

// DELETE /api/admin/products/:id
app.delete('/api/admin/products/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No encontrado' });
  // Borrar imagen física
  if (existing.image) {
    const imgPath = path.join(UPLOADS_DIR, existing.image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/stats
app.get('/api/admin/stats', (req, res) => {
  const total    = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
  const cats     = db.prepare('SELECT COUNT(DISTINCT cat) as n FROM products').get().n;
  const featured = db.prepare('SELECT COUNT(*) as n FROM products WHERE featured = 1').get().n;
  const noStock  = db.prepare('SELECT COUNT(*) as n FROM products WHERE stock = 0').get().n;
  res.json({ total, cats, featured, noStock });
});

// ── Arrancar ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛍  TIENDACAMI corriendo en → http://localhost:${PORT}`);
  console.log(`📦  Base de datos en       → db/catalogo.db`);
  console.log(`🖼️   Imágenes en            → uploads/\n`);
});
