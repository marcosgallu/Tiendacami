// ─────────────────────────────────────────────────────────────
//  DRIP STORE — Servidor Express + SQLite
//  Ejecutar:  node server.js
//  Abre en:   http://localhost:3000
// ─────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const Database = require('better-sqlite3');
const https   = require('https');

const app  = express();
const PORT = 3000;

// ── Mercado Pago ───────────────────────────────────────────────
// 1. Entrá a https://www.mercadopago.com.ar/developers/panel
// 2. Credenciales → copiá tu Access Token de PRODUCCIÓN
// 3. Pegalo acá abajo (nunca lo subas a GitHub)

// Esto lee el archivo .env oculto (Solo es necesario en tu compu)
require('dotenv').config(); 

const { MercadoPagoConfig, Preference } = require('mercadopago');

// --- MAGIA ACÁ ---
// En vez de poner el string, llamamos a "process.env"
const tokenSecreto = process.env.MP_ACCESS_TOKEN; 

const client = new MercadoPagoConfig({ accessToken: tokenSecreto });

// ── Middlewares ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // sirve el HTML

// ── Base de datos ──────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'db', 'store.db'));

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    cat       TEXT    NOT NULL,
    price     REAL    NOT NULL,
    old_price REAL,
    emoji     TEXT    DEFAULT '👔',
    sizes     TEXT    DEFAULT 'S,M,L',
    color     TEXT    DEFAULT '',
    badge     TEXT,
    created_at TEXT   DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cart (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 1,
    size       TEXT    DEFAULT 'M',
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sales (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    total      REAL    NOT NULL,
    sold_at    TEXT    DEFAULT (datetime('now'))
  );
`);

// Insertar productos de ejemplo si la tabla está vacía
const count = db.prepare('SELECT COUNT(*) as n FROM products').get();
if (count.n === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, cat, price, old_price, emoji, sizes, color, badge)
    VALUES (@name, @cat, @price, @oldPrice, @emoji, @sizes, @color, @badge)
  `);
  const seedMany = db.transaction((prods) => prods.forEach(p => insert.run(p)));
  seedMany([
    { name:'Vestido floral',   cat:'Mujer',      price:7990,  oldPrice:12990, emoji:'👗', sizes:'XS,S,M,L',          color:'Rosa/Blanco',  badge:'OFERTA' },
    { name:'Buzo oversized',   cat:'Mujer',      price:5490,  oldPrice:null,  emoji:'🧥', sizes:'S,M,L,XL',          color:'Verde menta',  badge:'NUEVO'  },
    { name:'Jean straight',    cat:'Hombre',     price:8990,  oldPrice:10990, emoji:'👖', sizes:'30,32,34,36',        color:'Azul clásico', badge:null     },
    { name:'Remera gráfica',   cat:'Hombre',     price:3290,  oldPrice:null,  emoji:'👕', sizes:'S,M,L,XL,XXL',      color:'Blanco/Negro', badge:'HOT'    },
    { name:'Mochila urbana',   cat:'Accesorios', price:4990,  oldPrice:6990,  emoji:'🎒', sizes:'Único',             color:'Negro',        badge:'OFERTA' },
    { name:'Zapatillas retro', cat:'Hombre',     price:12990, oldPrice:null,  emoji:'👟', sizes:'38,39,40,41,42,43', color:'Blanco',       badge:'NUEVO'  },
    { name:'Vestido niña',     cat:'Niños',      price:3490,  oldPrice:4990,  emoji:'🌸', sizes:'2,4,6,8,10',        color:'Fucsia',       badge:null     },
    { name:'Gorra cap',        cat:'Accesorios', price:1990,  oldPrice:null,  emoji:'🧢', sizes:'Único',             color:'Multicolor',   badge:null     },
    { name:'Campera denim',    cat:'Mujer',      price:9990,  oldPrice:13990, emoji:'🫐', sizes:'XS,S,M,L,XL',       color:'Celeste',      badge:'OFERTA' },
    { name:'Short cargo',      cat:'Hombre',     price:4290,  oldPrice:null,  emoji:'🩳', sizes:'S,M,L,XL',          color:'Beige',        badge:'NUEVO'  },
  ]);
  console.log('✅ Productos de ejemplo insertados');
}

// ══════════════════════════════════════════════════════════════
//  API — PRODUCTOS
// ══════════════════════════════════════════════════════════════

// GET /api/products?cat=Mujer&q=vestido
app.get('/api/products', (req, res) => {
  const { cat, q } = req.query;
  let sql    = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (cat && cat !== 'Todo') { sql += ' AND cat = ?';                          params.push(cat); }
  if (q)                     { sql += ' AND (name LIKE ? OR color LIKE ?)';    params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params);
  // Convertir sizes de "S,M,L" a ["S","M","L"]
  res.json(rows.map(p => ({ ...p, sizes: p.sizes.split(',') })));
});

// GET /api/products/:id
app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ ...row, sizes: row.sizes.split(',') });
});

// POST /api/products
app.post('/api/products', (req, res) => {
  const { name, cat, price, oldPrice, emoji, sizes, color, badge } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
  const stmt = db.prepare(`
    INSERT INTO products (name, cat, price, old_price, emoji, sizes, color, badge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    name, cat || 'Mujer', price,
    oldPrice || null,
    emoji || '👔',
    Array.isArray(sizes) ? sizes.join(',') : (sizes || 'S,M,L'),
    color || '',
    badge || 'NUEVO'
  );
  const newProd = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...newProd, sizes: newProd.sizes.split(',') });
});

// PUT /api/products/:id
app.put('/api/products/:id', (req, res) => {
  const { name, cat, price, oldPrice, emoji, sizes, color, badge } = req.body;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });
  db.prepare(`
    UPDATE products SET
      name=?, cat=?, price=?, old_price=?, emoji=?, sizes=?, color=?, badge=?
    WHERE id=?
  `).run(
    name || existing.name,
    cat  || existing.cat,
    price ?? existing.price,
    oldPrice ?? existing.old_price,
    emoji || existing.emoji,
    Array.isArray(sizes) ? sizes.join(',') : (sizes || existing.sizes),
    color ?? existing.color,
    badge ?? existing.badge,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ ...updated, sizes: updated.sizes.split(',') });
});

// DELETE /api/products/:id
app.delete('/api/products/:id', (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  API — CARRITO
// ══════════════════════════════════════════════════════════════

// GET /api/cart  — devuelve items con info del producto
app.get('/api/cart', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.qty, c.size,
           p.id as product_id, p.name, p.price, p.emoji, p.cat
    FROM cart c
    JOIN products p ON p.id = c.product_id
  `).all();
  res.json(rows);
});

// POST /api/cart  — agrega o incrementa
app.post('/api/cart', (req, res) => {
  const { product_id, size } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id requerido' });
  const existing = db.prepare('SELECT * FROM cart WHERE product_id = ? AND size = ?').get(product_id, size || 'M');
  if (existing) {
    db.prepare('UPDATE cart SET qty = qty + 1 WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO cart (product_id, qty, size) VALUES (?, 1, ?)').run(product_id, size || 'M');
  }
  res.json({ ok: true });
});

// PUT /api/cart/:id  — cambia cantidad
app.put('/api/cart/:id', (req, res) => {
  const { qty } = req.body;
  if (qty <= 0) {
    db.prepare('DELETE FROM cart WHERE id = ?').run(req.params.id);
  } else {
    db.prepare('UPDATE cart SET qty = ? WHERE id = ?').run(qty, req.params.id);
  }
  res.json({ ok: true });
});

// DELETE /api/cart/:id
app.delete('/api/cart/:id', (req, res) => {
  db.prepare('DELETE FROM cart WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/cart  — vaciar carrito
app.delete('/api/cart', (req, res) => {
  db.prepare('DELETE FROM cart').run();
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  API — MERCADO PAGO + VENTAS
// ══════════════════════════════════════════════════════════════

// POST /api/crear-preferencia
// Crea una preferencia de pago en MP y devuelve el link de pago.
// El frontend redirige al usuario a ese link.
app.post('/api/crear-preferencia', async (req, res) => {
  const { items, total } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Items requeridos' });

  // Armamos la preferencia de pago de Mercado Pago
  const preferencia = {
    items: items.map(item => ({
      title:       item.name,
      quantity:    item.qty,
      unit_price:  item.price,
      currency_id: 'ARS',
    })),
    // Adonde va el cliente después de pagar (cambiá por tu dominio real)
    back_urls: {
      success: 'http://localhost:3000/pago-exitoso',
      failure: 'http://localhost:3000/pago-fallido',
      pending: 'http://localhost:3000/pago-pendiente',
    },
    auto_return: 'approved',
    // Referencia tuya para saber qué pedido es
    external_reference: `orden-${Date.now()}`,
  };

  // Llamada a la API de MP
  const body = JSON.stringify(preferencia);
  const options = {
    hostname: 'api.mercadopago.com',
    path:     '/checkout/preferences',
    method:   'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
    },
  };

  const mpRequest = https.request(options, mpRes => {
    let data = '';
    mpRes.on('data', chunk => data += chunk);
    mpRes.on('end', () => {
      try {
        const mpData = JSON.parse(data);
        if (mpRes.statusCode !== 201) {
          return res.status(mpRes.statusCode).json({ error: mpData.message || 'Error de MP' });
        }
        // init_point = link de pago real
        // sandbox_init_point = link de prueba
        res.json({
          init_point:         mpData.init_point,
          sandbox_init_point: mpData.sandbox_init_point,
          id:                 mpData.id,
        });
      } catch(e) {
        res.status(500).json({ error: 'Error al procesar respuesta de MP' });
      }
    });
  });
  mpRequest.on('error', err => res.status(500).json({ error: err.message }));
  mpRequest.write(body);
  mpRequest.end();
});

// POST /api/webhook-mp
// Mercado Pago llama a esta URL cuando el pago se aprueba.
// Configuralo en: MP → Tus integraciones → Webhooks → URL
app.post('/api/webhook-mp', (req, res) => {
  const { type, data } = req.body;
  if (type === 'payment') {
    // Acá podés consultar el pago con el ID y actualizar tu BD
    // GET https://api.mercadopago.com/v1/payments/:id
    console.log('💰 Pago recibido, ID:', data?.id);
    // Registrar la venta en la BD local
    db.prepare('INSERT INTO sales (total) VALUES (?)').run(0); // actualizar con monto real
  }
  res.sendStatus(200); // MP necesita 200 para no reintentar
});

// POST /api/confirmar-pago  — cuando MP redirige de vuelta con éxito
app.post('/api/confirmar-pago', (req, res) => {
  const { total } = req.body;
  if (!total) return res.status(400).json({ error: 'Total requerido' });
  db.prepare('INSERT INTO sales (total) VALUES (?)').run(total);
  db.prepare('DELETE FROM cart').run();
  res.json({ ok: true, message: '¡Compra registrada!' });
});

// Páginas de retorno de MP
app.get('/pago-exitoso',  (req, res) => res.send('<h2>✅ ¡Pago aprobado! <a href="/">Volver a la tienda</a></h2>'));
app.get('/pago-fallido',  (req, res) => res.send('<h2>❌ El pago falló. <a href="/">Volver a la tienda</a></h2>'));
app.get('/pago-pendiente',(req, res) => res.send('<h2>⏳ Pago pendiente. Te avisamos por email.</h2>'));

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const products   = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
  const categories = db.prepare('SELECT COUNT(DISTINCT cat) as n FROM products').get().n;
  const salesToday = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as total FROM sales
    WHERE date(sold_at) = date('now')
  `).get().total;
  const cartItems  = db.prepare('SELECT COALESCE(SUM(qty), 0) as n FROM cart').get().n;
  res.json({ products, categories, salesToday, cartItems });
});

// ── Arrancar servidor ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛍  DRIP STORE corriendo en → http://localhost:${PORT}`);
  console.log(`📦  Base de datos en        → db/store.db\n`);
});
