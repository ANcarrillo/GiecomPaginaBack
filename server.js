const express    = require('express')
const mysql      = require('mysql2/promise')
const bcrypt     = require('bcrypt')
const jwt        = require('jsonwebtoken')
const cors       = require('cors')
const multer     = require('multer')
const path       = require('path')
const fs         = require('fs')

const app  = express()
const PORT = 4000
const JWT_SECRET = 'giecom_secret_2026'

app.use(cors({
    // DEV:        http://localhost:5173
    // PRODUCCIÓN: cambia por la URL de tu sitio, ej: https://giecom.uniamazonia.edu.co
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}))
app.use(express.json())

// ── Imágenes estáticas ────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)
app.use('/uploads', express.static(uploadsDir))

// ── Multer ────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename:    (req, file, cb) => {
        const ext  = path.extname(file.originalname)
        cb(null, `miembro_${Date.now()}${ext}`)
    },
})
const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Solo JPG, PNG o WEBP'))
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 3 * 1024 * 1024 } })

// ── Conexión MySQL ────────────────────────────────────────────────────────
const db = mysql.createPool({
    host:               '158.220.123.106',
    user:               'pagprinci',
    password:           'PagPrinci*2026',
    database:           'paginaprincipal',
    port:               3306,
    waitForConnections: true,
    connectionLimit:    10,
})

// ── Probar conexión al arrancar ───────────────────────────────────────────
db.getConnection()
    .then(conn => {
        console.log('✅ MySQL conectado correctamente a 158.220.123.106')
        conn.release()
    })
    .catch(err => {
        console.error('❌ Error conectando a MySQL:', err.message)
    })

// ── Auth middleware ───────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const header = req.headers['authorization']
    if (!header) return res.status(401).json({ error: 'Sin token' })
    const token = header.split(' ')[1]
    try {
        req.user = jwt.verify(token, JWT_SECRET)
        next()
    } catch {
        res.status(401).json({ error: 'Token inválido' })
    }
}

// ── Eliminar imagen del disco ─────────────────────────────────────────────
function eliminarImagenAnterior(imagenUrl) {
    if (!imagenUrl) return
    try {
        const filename = imagenUrl.split('/uploads/')[1]
        if (!filename) return
        const filepath = path.join(uploadsDir, filename)
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    } catch {}
}

// ══════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICO — GET /api/ping
// Abre http://localhost:4000/api/ping para verificar que todo funciona
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/ping', async (req, res) => {
    const resultado = { servidor: 'ok', mysql: null, tablas: {} }
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS resultado')
        resultado.mysql = rows[0].resultado === 2 ? 'ok' : 'error'

        // Verificar que las tablas existen
        const [tablas] = await db.query("SHOW TABLES")
        resultado.tablas_encontradas = tablas.map(t => Object.values(t)[0])

        // Verificar usuario admin
        const [usuarios] = await db.query('SELECT usuario FROM usuarios')
        resultado.usuarios_en_db = usuarios.map(u => u.usuario)

    } catch (err) {
        resultado.mysql = 'error'
        resultado.mysql_error = err.message
    }
    res.json(resultado)
})

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
    const { usuario, password } = req.body
    if (!usuario || !password)
        return res.status(400).json({ error: 'Faltan campos' })
    try {
        const [rows] = await db.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario])
        if (rows.length === 0)
            return res.status(401).json({ error: 'Usuario no encontrado' })

        const valido = await bcrypt.compare(password, rows[0].password)
        if (!valido)
            return res.status(401).json({ error: 'Contraseña incorrecta' })

        const token = jwt.sign(
            { id: rows[0].id, usuario: rows[0].usuario },
            JWT_SECRET,
            { expiresIn: '8h' }
        )
        res.json({ token, usuario: rows[0].usuario })
    } catch (err) {
        console.error('Error en login:', err.message)
        res.status(500).json({ error: 'Error del servidor', detalle: err.message })
    }
})

// ══════════════════════════════════════════════════════════════════════════
// UPLOAD IMAGEN
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/upload', authMiddleware, upload.single('imagen'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' })
    // DEV:        http://localhost:4000
    // PRODUCCIÓN: cambia por la IP/dominio del servidor, ej: http://158.220.123.106:4000
    const BASE_URL = process.env.SERVER_URL || `http://localhost:${PORT}`
    const url = `${BASE_URL}/uploads/${req.file.filename}`
    res.json({ url })
})

// ══════════════════════════════════════════════════════════════════════════
// MIEMBROS
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/miembros', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM miembros ORDER BY id ASC')
        res.json(rows)
    } catch (err) {
        console.error('Error GET miembros:', err.message)
        res.status(500).json({ error: 'Error al obtener miembros', detalle: err.message })
    }
})

app.post('/api/miembros', authMiddleware, async (req, res) => {
    const { nombre, rol, correo, telefono, cvlac, imagen } = req.body
    if (!nombre || !rol)
        return res.status(400).json({ error: 'Nombre y rol son obligatorios' })
    try {
        const [result] = await db.query(
            'INSERT INTO miembros (nombre, rol, correo, telefono, cvlac, imagen) VALUES (?,?,?,?,?,?)',
            [nombre, rol, correo || null, telefono || null, cvlac || null, imagen || null]
        )
        const [rows] = await db.query('SELECT * FROM miembros WHERE id = ?', [result.insertId])
        res.status(201).json(rows[0])
    } catch (err) {
        console.error('Error POST miembros:', err.message)
        res.status(500).json({ error: 'Error al crear miembro', detalle: err.message })
    }
})

app.put('/api/miembros/:id', authMiddleware, async (req, res) => {
    const { nombre, rol, correo, telefono, cvlac, imagen } = req.body
    if (!nombre || !rol)
        return res.status(400).json({ error: 'Nombre y rol son obligatorios' })
    try {
        const [old] = await db.query('SELECT imagen FROM miembros WHERE id = ?', [req.params.id])
        if (old.length && old[0].imagen !== imagen) eliminarImagenAnterior(old[0].imagen)

        await db.query(
            'UPDATE miembros SET nombre=?, rol=?, correo=?, telefono=?, cvlac=?, imagen=? WHERE id=?',
            [nombre, rol, correo || null, telefono || null, cvlac || null, imagen || null, req.params.id]
        )
        const [rows] = await db.query('SELECT * FROM miembros WHERE id = ?', [req.params.id])
        if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' })
        res.json(rows[0])
    } catch (err) {
        console.error('Error PUT miembros:', err.message)
        res.status(500).json({ error: 'Error al actualizar miembro', detalle: err.message })
    }
})

app.delete('/api/miembros/:id', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT imagen FROM miembros WHERE id = ?', [req.params.id])
        if (rows.length) eliminarImagenAnterior(rows[0].imagen)
        await db.query('DELETE FROM miembros WHERE id = ?', [req.params.id])
        res.json({ ok: true })
    } catch (err) {
        console.error('Error DELETE miembros:', err.message)
        res.status(500).json({ error: 'Error al eliminar miembro', detalle: err.message })
    }
})

// ── Arrancar servidor ─────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Servidor GIECOM corriendo en http://localhost:${PORT}`))