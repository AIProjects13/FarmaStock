import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ---------------------------------------------------------------
// FIREBASE (mismo proyecto "varios-85d7c" que el resto de tus apps)
// ---------------------------------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyCtZnrcLj9wYFQnVKvC8-owb7JAaPXpUS8",
    authDomain: "varios-85d7c.firebaseapp.com",
    projectId: "varios-85d7c",
    storageBucket: "varios-85d7c.firebasestorage.app",
    messagingSenderId: "67103964963",
    appId: "1:67103964963:web:8ee9f644fede4d1604d696",
    measurementId: "G-8BMMP80PJ7"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserSessionPersistence).catch(console.error);
const db = getFirestore(app);

// Colección PROPIA de FarmaStock. El proyecto de Firebase es compartido
// con otras apps (Farmacia OS usa "farmacia_roles", el Tutor de IA usa
// "AI_Tutor_users"), así que cualquiera con cuenta en el proyecto puede
// autenticarse aquí — el control real de acceso es este documento de rol.
const ROLES_COLLECTION = "inventario_roles";
const ADMIN_FALLBACK_EMAIL = "fernan151085@gmail.com";

// ---------------------------------------------------------------
// BACKEND (Google Apps Script)
// ---------------------------------------------------------------
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxCbsraiRWveHgUR9GuHCB0KxTXqLe7POFVilEoRviB7QNaMMjf_TwMT2utWTO1wkc1/exec";

// ---------------------------------------------------------------
// ESTADO GLOBAL
// ---------------------------------------------------------------
let DB = { Productos: [], Historial_Movimientos: [], Lotes: [] };
let currentUser = null;
let userRole = null; // 'admin' | 'viewer'
let activeTab = 'tab-dash';
const IMAGEN_LIMITE_CHARS = 40000;
const DEFAULT_STOCK_MINIMO = 5;

window.addEventListener('error', (event) => {
    console.error("Global Error:", event.error);
    showToast(`Error: ${event.message}`, 'error');
});

// ---------------------------------------------------------------
// UTILIDADES UI
// ---------------------------------------------------------------
const showToast = window.showToast = (msg, type = 'success') => {
    const t = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    document.getElementById('toast-icon').className = type === 'error'
        ? 'fa-solid fa-circle-xmark text-red-500 text-lg'
        : 'fa-solid fa-circle-check text-accent text-lg';
    t.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), type === 'error' ? 5000 : 3000);
};

window.togglePassword = () => {
    const p = document.getElementById('auth-password');
    const icon = document.getElementById('eye-icon');
    const isPwd = p.type === 'password';
    p.type = isPwd ? 'text' : 'password';
    icon.className = isPwd ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
};

window.openModal = id => {
    document.getElementById(id).classList.add('open');
    document.getElementById(id).classList.remove('hidden-view');
};
window.closeModal = id => {
    document.getElementById(id).classList.remove('open');
    setTimeout(() => document.getElementById(id).classList.add('hidden-view'), 250);
};

window.toggleSidebar = () => {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (window.innerWidth < 768) {
        // Celular: el menú se desliza encima del contenido, con fondo oscuro detrás.
        if (sb) sb.classList.toggle('-translate-x-full');
        if (ov) ov.classList.toggle('hidden');
    } else {
        // Escritorio: el menú se colapsa (se oculta con margen) en vez de deslizarse.
        if (sb) sb.classList.toggle('md:-ml-64');
    }
};

const setLoader = (visible) => {
    document.getElementById('global-loader').style.display = visible ? 'flex' : 'none';
};

const fmtMoney = (n) => `Q${(Number(n) || 0).toFixed(2)}`;
const stockMinimo = (p) => (p.Stock_Minimo !== undefined && p.Stock_Minimo !== '' && p.Stock_Minimo !== null) ? Number(p.Stock_Minimo) : DEFAULT_STOCK_MINIMO;
const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
};
const daysUntil = (s) => {
    if (!s) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return Math.round((d - hoy) / 86400000);
};

// ---------------------------------------------------------------
// NAVEGACIÓN
// ---------------------------------------------------------------
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const target = btn.dataset.target;
        activeTab = target;
        document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden-view'));
        document.getElementById(target).classList.remove('hidden-view');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('top-title').innerText = btn.innerText.trim();
        if (window.innerWidth < 768) window.toggleSidebar();

        if (target === 'tab-inv') renderInventario();
        if (target === 'tab-hist') renderHistorial();
        if (target === 'tab-dash') renderDashboard();
    });
});

// ---------------------------------------------------------------
// LOGIN / AUTENTICACIÓN
// ---------------------------------------------------------------
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-password').value;
    const btn = document.getElementById('btn-login');
    const err = document.getElementById('login-error');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ingresando…';

    signInWithEmailAndPassword(auth, email, pass).catch((error) => {
        console.error(error);
        err.innerText = 'Correo o contraseña incorrectos.';
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
    });
});

window.handleLogout = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        setLoader(true);
        currentUser = user.email;

        try {
            const emailKey = user.email.toLowerCase();
            let role = null;

            if (emailKey === ADMIN_FALLBACK_EMAIL) {
                role = 'admin';
            } else {
                const roleDoc = await getDoc(doc(db, ROLES_COLLECTION, emailKey));
                if (roleDoc.exists()) {
                    role = roleDoc.data().role || roleDoc.data().rol || 'viewer';
                }
            }

            if (!role) {
                showToast('Tu cuenta no tiene acceso a FarmaStock. Contacta al administrador.', 'error');
                setLoader(false);
                await signOut(auth);
                return;
            }

            userRole = role;
            document.body.classList.toggle('role-viewer', userRole !== 'admin');

            document.getElementById('user-display').innerText = user.email.split('@')[0];
            document.getElementById('user-avatar').innerText = user.email.charAt(0).toUpperCase();
            const roleBadge = document.getElementById('user-role-badge');
            roleBadge.innerText = userRole === 'admin' ? 'Administrador' : 'Solo lectura';
            roleBadge.className = userRole === 'admin' ? 'text-[10px] font-bold uppercase tracking-wide text-accent' : 'text-[10px] font-bold uppercase tracking-wide text-gray-400';

            document.getElementById('auth-view').classList.add('hidden-view');
            document.getElementById('app-view').classList.remove('hidden-view');

            document.getElementById('btn-login').disabled = false;
            document.getElementById('btn-login').innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';

            await syncData();
        } catch (e) {
            console.error(e);
            if (e && e.code === 'permission-denied') {
                showToast('Firestore bloqueó la verificación de tu rol (revisa las reglas de "inventario_roles").', 'error');
            } else {
                showToast('Error al inicializar FarmaStock: ' + (e && e.message ? e.message : 'error desconocido'), 'error');
            }
        } finally {
            setLoader(false);
        }
    } else {
        userRole = null;
        document.getElementById('app-view').classList.add('hidden-view');
        document.getElementById('auth-view').classList.remove('hidden-view');
        setLoader(false);
    }
});

// ---------------------------------------------------------------
// API
// ---------------------------------------------------------------
async function apiCall(action, extra = {}) {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ token, role: userRole, action, usuario: currentUser, ...extra })
    });
    const json = await res.json();
    if (json.status === 'error') {
        showToast(json.message || 'Ocurrió un error', 'error');
        throw new Error(json.message || 'Error de API');
    }
    return json;
}

window.syncData = async () => {
    const icon = document.getElementById('sync-icon');
    if (icon) icon.classList.add('fa-spin');
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`${SCRIPT_URL}?action=readAll&_cb=${Date.now()}&token=${encodeURIComponent(token)}`);
        const json = await res.json();
        if (json.status === 'error') throw new Error(json.message);
        DB.Productos = json.data.Productos || [];
        DB.Historial_Movimientos = json.data.Historial_Movimientos || [];
        DB.Lotes = json.data.Lotes || [];
        renderDashboard();
        renderInventario();
        renderHistorial();
    } catch (e) {
        console.error(e);
        showToast('No se pudo sincronizar con la hoja de cálculo.', 'error');
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
};

// ---------------------------------------------------------------
// IMAGEN (compresión a Base64 para caber en una celda de Sheets)
// ---------------------------------------------------------------
function comprimirImagen(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const maxDim = 420;
                let { width, height } = img;
                if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
                else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }

                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                let quality = 0.7;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);
                while (dataUrl.length > IMAGEN_LIMITE_CHARS && quality > 0.25) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }
                if (dataUrl.length > IMAGEN_LIMITE_CHARS) {
                    reject(new Error('La imagen es demasiado grande incluso comprimida. Prueba con una foto más simple.'));
                    return;
                }
                resolve(dataUrl);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function mostrarPreviewImagen(dataUrl) {
    const img = document.getElementById('prd-imagen-preview');
    const icon = document.getElementById('prd-imagen-icon');
    const hint = document.getElementById('prd-imagen-hint');
    const quitarBtn = document.getElementById('prd-imagen-quitar');
    document.getElementById('prd-imagen-data').value = dataUrl || '';

    if (dataUrl) {
        img.src = dataUrl;
        img.classList.remove('hidden');
        icon.classList.add('hidden');
        hint.innerText = 'Imagen lista';
        quitarBtn.classList.remove('hidden');
    } else {
        img.classList.add('hidden');
        icon.classList.remove('hidden');
        hint.innerText = 'Haz clic o arrastra una imagen (máx. ~40 KB comprimida)';
        quitarBtn.classList.add('hidden');
    }
}

window.quitarImagenProducto = (e) => {
    e.stopPropagation();
    document.getElementById('prd-imagen-input').value = '';
    mostrarPreviewImagen('');
};

// La foto NO viaja en el listado general (con muchos productos sobrecargaría
// el navegador); se pide sola, bajo demanda, solo cuando abres ese producto.
async function fetchImagenProducto(id) {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${SCRIPT_URL}?action=getImagen&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'No se pudo cargar la foto');
    return json.imagen || '';
}

// Compatible con las dos formas que puede tener el producto en DB:
// - Backend actualizado: manda Tiene_Imagen (booleano) y hay que pedir la foto aparte.
// - Backend desplegado sin actualizar todavía: manda Imagen_Base64 completo en el listado.
async function resolveImagenProducto(p, id) {
    if (p.Imagen_Base64) return p.Imagen_Base64;
    if (!p.Tiene_Imagen) return '';
    return fetchImagenProducto(id);
}

function setImagenCargando(loading) {
    const icon = document.getElementById('prd-imagen-icon');
    const hint = document.getElementById('prd-imagen-hint');
    const guardarBtn = document.getElementById('prd-btn-guardar');
    const fileInput = document.getElementById('prd-imagen-input');

    if (loading) {
        icon.className = 'fa-solid fa-spinner fa-spin text-2xl text-gray-300 mb-2';
        icon.classList.remove('hidden');
        hint.innerText = 'Cargando foto…';
        guardarBtn.disabled = true;
        fileInput.disabled = true;
    } else {
        icon.className = 'fa-solid fa-image text-2xl text-gray-300 mb-2';
        guardarBtn.disabled = false;
        fileInput.disabled = false;
    }
}

async function manejarArchivoImagen(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
        const dataUrl = await comprimirImagen(file);
        mostrarPreviewImagen(dataUrl);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

const dropZone = document.getElementById('prd-drop');
const fileInput = document.getElementById('prd-imagen-input');
fileInput.addEventListener('change', () => manejarArchivoImagen(fileInput.files[0]));
['dragover', 'dragenter'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
dropZone.addEventListener('drop', (e) => manejarArchivoImagen(e.dataTransfer.files[0]));

// ---------------------------------------------------------------
// LOTES: un producto puede tener varias entradas con fechas de vencimiento
// distintas (el que ya había + cada reabastecimiento). Existencias en el
// producto es el total; cada lote es el detalle de qué cantidad vence cuándo.
// ---------------------------------------------------------------
function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

function lotesDeProducto(idProducto) {
    return (DB.Lotes || []).filter(l => String(l.ID_Producto) === String(idProducto));
}

function ordenarPorVencimiento(lotes) {
    return lotes.slice().sort((a, b) => {
        if (!a.Fecha_Vencimiento && !b.Fecha_Vencimiento) return 0;
        if (!a.Fecha_Vencimiento) return 1;
        if (!b.Fecha_Vencimiento) return -1;
        return String(a.Fecha_Vencimiento).localeCompare(String(b.Fecha_Vencimiento));
    });
}

function lotesActivosDe(idProducto) {
    return ordenarPorVencimiento(lotesDeProducto(idProducto).filter(l => (Number(l.Cantidad_Restante) || 0) > 0));
}

function proximoVencimientoLote(idProducto) {
    const conFecha = lotesActivosDe(idProducto).find(l => l.Fecha_Vencimiento);
    return conFecha ? conFecha.Fecha_Vencimiento : null;
}

function loteChipHtml(l, mostrarProducto = false) {
    const restante = Number(l.Cantidad_Restante) || 0;
    const agotado = restante <= 0;
    const dias = l.Fecha_Vencimiento ? daysUntil(l.Fecha_Vencimiento) : null;

    let badge = '<span class="badge badge-gray">Sin fecha</span>';
    if (dias !== null) {
        if (dias < 0) badge = '<span class="badge badge-red">Vencido</span>';
        else if (dias <= 30) badge = `<span class="badge badge-amber">${dias}d</span>`;
        else badge = `<span class="badge badge-gray">${fmtDate(l.Fecha_Vencimiento)}</span>`;
    }

    return `
        <div class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100 ${agotado ? 'opacity-50' : 'bg-gray-50'}">
            <div class="min-w-0">
                ${mostrarProducto ? `<p class="text-sm font-bold text-primary truncate">${escapeHtml(l.Producto_Nombre || '')}</p>` : ''}
                <p class="text-xs ${agotado ? 'text-gray-400 line-through' : 'text-gray-600'}">${restante} / ${l.Cantidad_Inicial} uds${l.Fecha_Vencimiento ? ' · vence ' + fmtDate(l.Fecha_Vencimiento) : ' · sin fecha'}</p>
            </div>
            ${agotado ? '<span class="badge badge-gray">Agotado</span>' : badge}
        </div>
    `;
}

// ---------------------------------------------------------------
// PRODUCTOS: crear / editar / eliminar
// ---------------------------------------------------------------
window.calcMargen = () => {
    const costo = Number(document.getElementById('prd-costo').value) || 0;
    const precio = Number(document.getElementById('prd-precio').value) || 0;
    const margen = precio > 0 ? ((precio - costo) / precio) * 100 : 0;
    document.getElementById('prd-margen-calc').innerText = `${margen.toFixed(2)}%`;
};

function resetFormProducto() {
    document.getElementById('prd-id').value = '';
    document.getElementById('prd-nombre').value = '';
    document.getElementById('prd-costo').value = '';
    document.getElementById('prd-precio').value = '';
    document.getElementById('prd-cantidad-inicial').value = 0;
    document.getElementById('prd-existencias').value = '';
    document.getElementById('prd-stock-minimo').value = '';
    document.getElementById('prd-proveedor').value = '';
    document.getElementById('prd-proveedor-tel').value = '';
    document.getElementById('prd-vencimiento-inicial').value = '';
    document.getElementById('prd-lotes-list').innerHTML = '';
    mostrarPreviewImagen('');
    document.getElementById('prd-margen-calc').innerText = '0.00%';
}

window.openNewProducto = () => {
    resetFormProducto();
    document.getElementById('mod-prod-title').innerText = 'Nuevo producto';
    document.getElementById('prd-cantidad-wrap').classList.remove('hidden');
    document.getElementById('prd-existencias-wrap').classList.add('hidden');
    document.getElementById('prd-vencimiento-wrap').classList.remove('hidden');
    document.getElementById('prd-lotes-wrap').classList.add('hidden');
    document.getElementById('prd-btn-eliminar').classList.add('hidden');
    openModal('mod-producto');
};

window.openEditProducto = async (id) => {
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    resetFormProducto();
    document.getElementById('mod-prod-title').innerText = 'Editar producto';
    document.getElementById('prd-id').value = p.ID_Producto;
    document.getElementById('prd-nombre').value = p.Nombre || '';
    document.getElementById('prd-costo').value = p.Costo || 0;
    document.getElementById('prd-precio').value = p.Precio_Venta || 0;
    document.getElementById('prd-stock-minimo').value = p.Stock_Minimo || '';
    document.getElementById('prd-proveedor').value = p.Proveedor || '';
    document.getElementById('prd-proveedor-tel').value = p.Proveedor_Telefono || '';

    document.getElementById('prd-cantidad-wrap').classList.add('hidden');
    document.getElementById('prd-existencias-wrap').classList.remove('hidden');
    document.getElementById('prd-existencias').value = p.Existencias || 0;

    document.getElementById('prd-vencimiento-wrap').classList.add('hidden');
    document.getElementById('prd-lotes-wrap').classList.remove('hidden');
    const lotes = lotesActivosDe(id);
    document.getElementById('prd-lotes-list').innerHTML = lotes.map(l => loteChipHtml(l)).join('');
    document.getElementById('prd-lotes-empty').classList.toggle('hidden', lotes.length > 0);

    document.getElementById('prd-btn-eliminar').classList.toggle('hidden', userRole !== 'admin');
    calcMargen();
    openModal('mod-producto');

    if (p.Imagen_Base64 || p.Tiene_Imagen) {
        setImagenCargando(true);
        try {
            const imagen = await resolveImagenProducto(p, id);
            mostrarPreviewImagen(imagen);
        } catch (e) {
            console.error(e);
            showToast('No se pudo cargar la foto del producto.', 'error');
        } finally {
            setImagenCargando(false);
        }
    }
};

window.saveProducto = async () => {
    const id = document.getElementById('prd-id').value;
    const nombre = document.getElementById('prd-nombre').value.trim();
    const costo = document.getElementById('prd-costo').value;
    const precio = document.getElementById('prd-precio').value;
    const cantidadInicial = document.getElementById('prd-cantidad-inicial').value;

    if (!nombre || costo === '' || precio === '' || (!id && cantidadInicial === '')) {
        showToast('Completa los campos obligatorios: nombre, costo, precio y cantidad inicial.', 'error');
        return;
    }

    // El backend reescribe la fila completa, así que hay que reenviar
    // también los campos que no están en este formulario (existencias, etc.)
    const stockMinimoVal = document.getElementById('prd-stock-minimo').value;
    const rowData = {
        Nombre: nombre,
        Costo: Number(costo),
        Precio_Venta: Number(precio),
        Stock_Minimo: stockMinimoVal === '' ? '' : Number(stockMinimoVal),
        Proveedor: document.getElementById('prd-proveedor').value.trim(),
        Proveedor_Telefono: document.getElementById('prd-proveedor-tel').value.trim(),
        Imagen_Base64: document.getElementById('prd-imagen-data').value
    };

    const btn = document.getElementById('prd-btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando…';

    try {
        let resp;
        if (id) {
            const existente = DB.Productos.find(x => String(x.ID_Producto) === String(id)) || {};
            rowData.ID_Producto = id;
            rowData.Cantidad_Inicial = existente.Cantidad_Inicial;
            rowData.Existencias = existente.Existencias;
            rowData.Creado_En = existente.Creado_En;
            resp = await apiCall('crud', { sheetName: 'Productos', operation: 'update', idField: 'ID_Producto', idValue: id, rowData });
        } else {
            rowData.ID_Producto = 'PRD-' + Date.now() + Math.random().toString(36).substr(2, 6);
            rowData.Cantidad_Inicial = Number(cantidadInicial);
            rowData.Existencias = Number(cantidadInicial);
            const fechaInicial = document.getElementById('prd-vencimiento-inicial').value;
            resp = await apiCall('crud', {
                sheetName: 'Productos', operation: 'create', idField: 'ID_Producto', idValue: rowData.ID_Producto, rowData,
                loteInicial: { fechaVencimiento: fechaInicial }
            });
        }
        closeModal('mod-producto');
        if (resp.imagenRechazada) {
            showToast('Producto guardado, pero la imagen era muy pesada y no se guardó.', 'error');
        } else {
            showToast('Producto guardado correctamente.');
        }
        await syncData();
    } catch (e) {
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Guardar producto';
    }
};

let productoAEliminar = null;
window.confirmarEliminarProducto = () => {
    const id = document.getElementById('prd-id').value;
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    productoAEliminar = id;
    document.getElementById('confirm-delete-msg').innerText = `Se eliminará "${p.Nombre}" de forma permanente.`;
    openModal('mod-confirm-delete');
};

window.executeDeleteProducto = async () => {
    if (!productoAEliminar) return;
    try {
        await apiCall('crud', { sheetName: 'Productos', operation: 'delete', idField: 'ID_Producto', idValue: productoAEliminar });
        closeModal('mod-confirm-delete');
        closeModal('mod-producto');
        showToast('Producto eliminado.');
        productoAEliminar = null;
        await syncData();
    } catch (e) {
        console.error(e);
    }
};

// ---------------------------------------------------------------
// MOVIMIENTO DE STOCK (entradas de reabastecimiento / salidas de consumo)
// ---------------------------------------------------------------
window.setMovimientoTipo = (tipo) => {
    document.getElementById('mov-tipo').value = tipo;
    const tabEntrada = document.getElementById('mov-tab-entrada');
    const tabSalida = document.getElementById('mov-tab-salida');
    const esEntrada = tipo === 'Entrada';

    tabEntrada.className = 'py-2 rounded-lg text-sm font-bold transition ' + (esEntrada ? 'bg-white shadow text-primary' : 'text-gray-400');
    tabSalida.className = 'py-2 rounded-lg text-sm font-bold transition ' + (!esEntrada ? 'bg-white shadow text-red-500' : 'text-gray-400');

    document.getElementById('mov-campos-entrada').classList.toggle('hidden', !esEntrada);
    document.getElementById('mov-campos-salida').classList.toggle('hidden', esEntrada);
    document.getElementById('mov-cantidad-label').innerText = esEntrada ? 'Cantidad a agregar *' : 'Cantidad a descontar *';

    const btn = document.getElementById('mov-btn-guardar');
    btn.className = esEntrada ? 'flex-1 btn-accent' : 'flex-1 btn-danger !bg-red-500 !text-white !border-red-500';
};

function mostrarImagenMovimiento(dataUrl) {
    const img = document.getElementById('mov-imagen-preview');
    const icon = document.getElementById('mov-imagen-icon');
    if (dataUrl) {
        img.src = dataUrl;
        img.classList.remove('hidden');
        icon.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        img.removeAttribute('src');
        icon.className = 'fa-solid fa-box text-gray-300';
        icon.classList.remove('hidden');
    }
}

window.openMovimientoModal = async (id) => {
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    document.getElementById('mov-id-producto').value = id;
    document.getElementById('mov-nombre-producto').innerText = p.Nombre;
    document.getElementById('mov-existencias-actuales').innerText = p.Existencias || 0;
    document.getElementById('mov-cantidad').value = '';
    document.getElementById('mov-costo-unitario').value = p.Costo || '';
    document.getElementById('mov-proveedor').value = p.Proveedor || '';
    document.getElementById('mov-vencimiento').value = '';
    document.getElementById('mov-motivo').value = 'Consumo interno';
    document.getElementById('mov-notas').value = '';
    setMovimientoTipo('Entrada');
    mostrarImagenMovimiento('');
    openModal('mod-movimiento');

    if (p.Imagen_Base64 || p.Tiene_Imagen) {
        document.getElementById('mov-imagen-icon').className = 'fa-solid fa-spinner fa-spin text-gray-300';
        try {
            const imagen = await resolveImagenProducto(p, id);
            mostrarImagenMovimiento(imagen);
        } catch (e) {
            console.error(e);
            mostrarImagenMovimiento('');
        }
    }
};

window.saveMovimiento = async () => {
    const idProducto = document.getElementById('mov-id-producto').value;
    const tipo = document.getElementById('mov-tipo').value;
    const cantidad = Number(document.getElementById('mov-cantidad').value);
    if (!cantidad || cantidad <= 0) {
        showToast('Ingresa una cantidad válida.', 'error');
        return;
    }

    const btn = document.getElementById('mov-btn-guardar');
    btn.disabled = true;

    try {
        await apiCall('movimiento', {
            idProducto,
            tipo,
            cantidad,
            costoUnitario: tipo === 'Entrada' ? document.getElementById('mov-costo-unitario').value : '',
            proveedor: tipo === 'Entrada' ? document.getElementById('mov-proveedor').value.trim() : '',
            fechaVencimiento: tipo === 'Entrada' ? document.getElementById('mov-vencimiento').value : '',
            motivo: tipo === 'Salida' ? document.getElementById('mov-motivo').value : '',
            notas: document.getElementById('mov-notas').value.trim()
        });
        closeModal('mod-movimiento');
        showToast(tipo === 'Entrada' ? 'Entrada registrada correctamente.' : 'Salida registrada correctamente.');
        await syncData();
    } catch (e) {
        console.error(e);
    } finally {
        btn.disabled = false;
    }
};

function itemHistorialHtml(r) {
    const esEntrada = r.Tipo !== 'Salida';
    const detalle = esEntrada ? (r.Proveedor || '') : (r.Motivo || '');
    return `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center ${esEntrada ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}">
                    <i class="fa-solid ${esEntrada ? 'fa-arrow-down' : 'fa-arrow-up'} text-xs"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-sm font-bold text-primary">${esEntrada ? '+' : '-'}${r.Cantidad} unidades</p>
                    <p class="text-xs text-gray-400 truncate">${r.Fecha || ''} ${detalle ? '· ' + escapeHtml(detalle) : ''}</p>
                    ${r.Notas ? `<p class="text-xs text-gray-500 mt-1">${escapeHtml(r.Notas)}</p>` : ''}
                </div>
            </div>
            <span class="text-xs font-semibold text-gray-400 shrink-0">${r.Usuario || ''}</span>
        </div>
    `;
}

window.verHistorialProducto = (id) => {
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    document.getElementById('hist-prod-title').innerText = `Historial — ${p.Nombre}`;

    const lotes = ordenarPorVencimiento(lotesDeProducto(id));
    const lotesWrap = document.getElementById('hist-prod-lotes');
    const lotesEmpty = document.getElementById('hist-prod-lotes-empty');
    lotesWrap.innerHTML = lotes.map(l => loteChipHtml(l)).join('');
    lotesEmpty.classList.toggle('hidden', lotes.length > 0);

    const registros = (DB.Historial_Movimientos || [])
        .filter(r => String(r.ID_Producto) === String(id))
        .sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || ''));

    const list = document.getElementById('hist-prod-list');
    const empty = document.getElementById('hist-prod-empty');
    list.innerHTML = '';
    empty.classList.toggle('hidden', registros.length > 0);

    registros.forEach(r => list.insertAdjacentHTML('beforeend', itemHistorialHtml(r)));

    openModal('mod-historial-producto');
};

// ---------------------------------------------------------------
// RENDER: INVENTARIO
// ---------------------------------------------------------------
function badgeStock(p) {
    const existencias = Number(p.Existencias) || 0;
    if (existencias <= 0) return `<span class="badge badge-red"><i class="fa-solid fa-circle-xmark"></i>Sin stock</span>`;
    if (existencias <= stockMinimo(p)) return `<span class="badge badge-amber"><i class="fa-solid fa-battery-quarter"></i>${existencias} — stock bajo</span>`;
    return `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i>${existencias} en stock</span>`;
}

// Recibe la fecha del PRÓXIMO lote activo del producto (no un campo fijo en
// Productos), porque un mismo producto puede tener varios lotes con fechas
// distintas — ver proximoVencimientoLote().
function badgeVencimiento(fecha) {
    if (!fecha) return '';
    const dias = daysUntil(fecha);
    if (dias === null) return '';
    if (dias < 0) return `<span class="badge badge-red"><i class="fa-solid fa-triangle-exclamation"></i>Vencido</span>`;
    if (dias <= 30) return `<span class="badge badge-amber"><i class="fa-solid fa-hourglass-half"></i>Vence en ${dias}d</span>`;
    return `<span class="badge badge-gray"><i class="fa-solid fa-calendar"></i>${fmtDate(fecha)}</span>`;
}

window.renderInventario = () => {
    const term = (document.getElementById('inv-search').value || '').toLowerCase().trim();
    const tbody = document.getElementById('inv-tbody');
    const empty = document.getElementById('inv-empty');

    const productos = (DB.Productos || []).filter(p => {
        if (!term) return true;
        return (p.Nombre || '').toLowerCase().includes(term) || (p.Proveedor || '').toLowerCase().includes(term);
    }).sort((a, b) => (a.Nombre || '').localeCompare(b.Nombre || ''));

    tbody.innerHTML = '';
    empty.classList.toggle('hidden', productos.length > 0);

    productos.forEach(p => {
        const vencimiento = badgeVencimiento(proximoVencimientoLote(p.ID_Producto));
        tbody.insertAdjacentHTML('beforeend', `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3 min-w-[180px]">
                        <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 ${p.Tiene_Imagen ? 'text-accent' : 'text-gray-300'}" title="${p.Tiene_Imagen ? 'Tiene foto' : 'Sin foto'}">
                            <i class="fa-solid ${p.Tiene_Imagen ? 'fa-image' : 'fa-box'}"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-primary truncate">${escapeHtml(p.Nombre || '')}</p>
                            ${p.Proveedor ? `<p class="text-xs text-gray-400 truncate"><i class="fa-solid fa-truck-fast mr-1"></i>${escapeHtml(p.Proveedor)}${p.Proveedor_Telefono ? ' · ' + escapeHtml(p.Proveedor_Telefono) : ''}</p>` : ''}
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3 text-right">${badgeStock(p)}</td>
                <td class="px-4 py-3">${vencimiento || '<span class="text-gray-300">—</span>'}</td>
                <td class="px-4 py-3 text-right font-semibold text-primary whitespace-nowrap">${fmtMoney(p.Costo)}</td>
                <td class="px-4 py-3 text-right font-bold text-accent whitespace-nowrap">${fmtMoney(p.Precio_Venta)}</td>
                <td class="px-4 py-3">
                    <div class="flex items-center justify-end gap-1.5">
                        <button onclick="openMovimientoModal('${p.ID_Producto}')" class="admin-only w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-primary flex items-center justify-center" title="Movimiento"><i class="fa-solid fa-right-left text-xs"></i></button>
                        <button onclick="verHistorialProducto('${p.ID_Producto}')" class="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-primary flex items-center justify-center" title="Historial"><i class="fa-solid fa-clock-rotate-left text-xs"></i></button>
                        <button onclick="openEditProducto('${p.ID_Producto}')" class="admin-only w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-primary flex items-center justify-center" title="Editar"><i class="fa-solid fa-pen text-xs"></i></button>
                    </div>
                </td>
            </tr>
        `);
    });
};

// ---------------------------------------------------------------
// RENDER: DASHBOARD
// ---------------------------------------------------------------
window.renderDashboard = () => {
    const productos = DB.Productos || [];
    const sinStock = productos.filter(p => (Number(p.Existencias) || 0) <= 0);
    const stockBajo = productos
        .filter(p => { const e = Number(p.Existencias) || 0; return e > 0 && e <= stockMinimo(p); })
        .sort((a, b) => (Number(a.Existencias) || 0) - (Number(b.Existencias) || 0));
    // Por lote, no por producto: un mismo producto puede tener varios lotes
    // con fechas distintas y cada uno merece su propia alerta.
    const porVencer = (DB.Lotes || [])
        .filter(l => (Number(l.Cantidad_Restante) || 0) > 0 && l.Fecha_Vencimiento && daysUntil(l.Fecha_Vencimiento) !== null && daysUntil(l.Fecha_Vencimiento) <= 30)
        .sort((a, b) => daysUntil(a.Fecha_Vencimiento) - daysUntil(b.Fecha_Vencimiento));
    const valorVenta = productos.reduce((acc, p) => acc + (Number(p.Precio_Venta) || 0) * (Number(p.Existencias) || 0), 0);

    document.getElementById('kpi-total-productos').innerText = productos.length;
    document.getElementById('kpi-sin-stock').innerText = sinStock.length;
    document.getElementById('kpi-stock-bajo').innerText = stockBajo.length;
    document.getElementById('kpi-por-vencer').innerText = porVencer.length;
    document.getElementById('kpi-valor-venta').innerText = fmtMoney(valorVenta);

    const vencWrap = document.getElementById('dash-vencimientos');
    const vencEmpty = document.getElementById('dash-vencimientos-empty');
    vencWrap.innerHTML = '';
    vencEmpty.classList.toggle('hidden', porVencer.length > 0);
    porVencer.slice(0, 6).forEach(l => {
        const dias = daysUntil(l.Fecha_Vencimiento);
        vencWrap.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center shrink-0"><i class="fa-solid fa-box"></i></div>
                    <div class="min-w-0">
                        <p class="text-sm font-bold text-primary truncate">${escapeHtml(l.Producto_Nombre || '')}</p>
                        <p class="text-xs text-gray-400">${l.Cantidad_Restante} uds · ${fmtDate(l.Fecha_Vencimiento)}</p>
                    </div>
                </div>
                ${dias < 0 ? `<span class="badge badge-red">Vencido</span>` : `<span class="badge badge-amber">${dias}d</span>`}
            </div>
        `);
    });

    const bajoWrap = document.getElementById('dash-stock-bajo');
    const bajoEmpty = document.getElementById('dash-stock-bajo-empty');
    bajoWrap.innerHTML = '';
    bajoEmpty.classList.toggle('hidden', stockBajo.length > 0);
    stockBajo.slice(0, 6).forEach(p => {
        bajoWrap.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center shrink-0"><i class="fa-solid fa-battery-quarter"></i></div>
                    <div class="min-w-0">
                        <p class="text-sm font-bold text-primary truncate">${escapeHtml(p.Nombre || '')}</p>
                        <p class="text-xs text-gray-400">Mínimo: ${stockMinimo(p)}</p>
                    </div>
                </div>
                <span class="badge badge-amber">${p.Existencias || 0}</span>
            </div>
        `);
    });

    const recWrap = document.getElementById('dash-recientes');
    const recEmpty = document.getElementById('dash-recientes-empty');
    const recientes = (DB.Historial_Movimientos || []).slice().sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || '')).slice(0, 6);
    recWrap.innerHTML = '';
    recEmpty.classList.toggle('hidden', recientes.length > 0);
    recientes.forEach(r => {
        const esEntrada = r.Tipo !== 'Salida';
        recWrap.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between">
                <div class="min-w-0">
                    <p class="text-sm font-bold text-primary truncate">${escapeHtml(r.Producto_Nombre || '')}</p>
                    <p class="text-xs text-gray-400">${r.Fecha || ''}</p>
                </div>
                <span class="text-sm font-black shrink-0 ${esEntrada ? 'text-emerald-600' : 'text-red-500'}">${esEntrada ? '+' : '-'}${r.Cantidad}</span>
            </div>
        `);
    });
};

// ---------------------------------------------------------------
// RENDER: HISTORIAL GLOBAL
// ---------------------------------------------------------------
window.renderHistorial = () => {
    const term = (document.getElementById('hist-search').value || '').toLowerCase().trim();
    const tbody = document.getElementById('hist-tbody');
    const empty = document.getElementById('hist-empty');

    const registros = (DB.Historial_Movimientos || []).filter(r => {
        if (!term) return true;
        return (r.Producto_Nombre || '').toLowerCase().includes(term) || (r.Proveedor || '').toLowerCase().includes(term) || (r.Motivo || '').toLowerCase().includes(term);
    }).sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || ''));

    tbody.innerHTML = '';
    empty.classList.toggle('hidden', registros.length > 0);

    registros.forEach(r => {
        const esEntrada = r.Tipo !== 'Salida';
        tbody.insertAdjacentHTML('beforeend', `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-gray-500 whitespace-nowrap">${r.Fecha || ''}</td>
                <td class="px-4 py-3 font-semibold text-primary">${escapeHtml(r.Producto_Nombre || '')}</td>
                <td class="px-4 py-3">${esEntrada ? '<span class="badge badge-green">Entrada</span>' : '<span class="badge badge-red">Salida</span>'}</td>
                <td class="px-4 py-3 text-right font-bold ${esEntrada ? 'text-emerald-600' : 'text-red-500'}">${esEntrada ? '+' : '-'}${r.Cantidad}</td>
                <td class="px-4 py-3 text-gray-500">${escapeHtml((esEntrada ? r.Proveedor : r.Motivo) || '—')}</td>
                <td class="px-4 py-3 text-right text-gray-500">${r.Costo_Unitario ? fmtMoney(r.Costo_Unitario) : '—'}</td>
                <td class="px-4 py-3 text-gray-500">${escapeHtml(r.Usuario || '—')}</td>
                <td class="px-4 py-3 text-gray-400">${escapeHtml(r.Notas || '')}</td>
            </tr>
        `);
    });
};
