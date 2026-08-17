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
let DB = { Productos: [], Historial_Reabastecimiento: [] };
let currentUser = null;
let userRole = null; // 'admin' | 'viewer'
let activeTab = 'tab-dash';
const IMAGEN_LIMITE_CHARS = 40000;

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
    sb.classList.toggle('-translate-x-full');
    ov.classList.toggle('hidden');
};

const setLoader = (visible) => {
    document.getElementById('global-loader').style.display = visible ? 'flex' : 'none';
};

const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;
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
            showToast('Error al inicializar FarmaStock.', 'error');
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
        DB.Historial_Reabastecimiento = json.data.Historial_Reabastecimiento || [];
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
    document.getElementById('prd-proveedor').value = '';
    document.getElementById('prd-proveedor-tel').value = '';
    document.getElementById('prd-vencimiento').value = '';
    mostrarPreviewImagen('');
    document.getElementById('prd-margen-calc').innerText = '0.00%';
}

window.openNewProducto = () => {
    resetFormProducto();
    document.getElementById('mod-prod-title').innerText = 'Nuevo producto';
    document.getElementById('prd-cantidad-wrap').classList.remove('hidden');
    document.getElementById('prd-existencias-wrap').classList.add('hidden');
    document.getElementById('prd-btn-eliminar').classList.add('hidden');
    openModal('mod-producto');
};

window.openEditProducto = (id) => {
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    resetFormProducto();
    document.getElementById('mod-prod-title').innerText = 'Editar producto';
    document.getElementById('prd-id').value = p.ID_Producto;
    document.getElementById('prd-nombre').value = p.Nombre || '';
    document.getElementById('prd-costo').value = p.Costo || 0;
    document.getElementById('prd-precio').value = p.Precio_Venta || 0;
    document.getElementById('prd-proveedor').value = p.Proveedor || '';
    document.getElementById('prd-proveedor-tel').value = p.Proveedor_Telefono || '';
    document.getElementById('prd-vencimiento').value = p.Fecha_Vencimiento || '';
    if (p.Imagen_Base64) mostrarPreviewImagen(p.Imagen_Base64);

    document.getElementById('prd-cantidad-wrap').classList.add('hidden');
    document.getElementById('prd-existencias-wrap').classList.remove('hidden');
    document.getElementById('prd-existencias').value = p.Existencias || 0;

    document.getElementById('prd-btn-eliminar').classList.toggle('hidden', userRole !== 'admin');
    calcMargen();
    openModal('mod-producto');
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
    const rowData = {
        Nombre: nombre,
        Costo: Number(costo),
        Precio_Venta: Number(precio),
        Proveedor: document.getElementById('prd-proveedor').value.trim(),
        Proveedor_Telefono: document.getElementById('prd-proveedor-tel').value.trim(),
        Fecha_Vencimiento: document.getElementById('prd-vencimiento').value,
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
            resp = await apiCall('crud', { sheetName: 'Productos', operation: 'create', idField: 'ID_Producto', idValue: rowData.ID_Producto, rowData });
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
// REABASTECIMIENTO
// ---------------------------------------------------------------
window.openRestockModal = (id) => {
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    document.getElementById('rst-id-producto').value = id;
    document.getElementById('rst-nombre-producto').innerText = p.Nombre;
    document.getElementById('rst-existencias-actuales').innerText = p.Existencias || 0;
    document.getElementById('rst-cantidad').value = '';
    document.getElementById('rst-costo-unitario').value = p.Costo || '';
    document.getElementById('rst-proveedor').value = p.Proveedor || '';
    document.getElementById('rst-notas').value = '';
    openModal('mod-reabastecer');
};

window.saveRestock = async () => {
    const idProducto = document.getElementById('rst-id-producto').value;
    const cantidad = Number(document.getElementById('rst-cantidad').value);
    if (!cantidad || cantidad <= 0) {
        showToast('Ingresa una cantidad válida.', 'error');
        return;
    }

    try {
        await apiCall('restock', {
            idProducto,
            cantidad,
            costoUnitario: document.getElementById('rst-costo-unitario').value,
            proveedor: document.getElementById('rst-proveedor').value.trim(),
            notas: document.getElementById('rst-notas').value.trim()
        });
        closeModal('mod-reabastecer');
        showToast('Stock actualizado correctamente.');
        await syncData();
    } catch (e) {
        console.error(e);
    }
};

window.verHistorialProducto = (id) => {
    const p = DB.Productos.find(x => String(x.ID_Producto) === String(id));
    if (!p) return;
    document.getElementById('hist-prod-title').innerText = `Historial — ${p.Nombre}`;

    const registros = (DB.Historial_Reabastecimiento || [])
        .filter(r => String(r.ID_Producto) === String(id))
        .sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || ''));

    const list = document.getElementById('hist-prod-list');
    const empty = document.getElementById('hist-prod-empty');
    list.innerHTML = '';
    empty.classList.toggle('hidden', registros.length > 0);

    registros.forEach(r => {
        list.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                    <p class="text-sm font-bold text-primary">+${r.Cantidad} unidades</p>
                    <p class="text-xs text-gray-400">${r.Fecha || ''} ${r.Proveedor ? '· ' + r.Proveedor : ''}</p>
                    ${r.Notas ? `<p class="text-xs text-gray-500 mt-1">${escapeHtml(r.Notas)}</p>` : ''}
                </div>
                <span class="text-xs font-semibold text-gray-400">${r.Usuario || ''}</span>
            </div>
        `);
    });

    openModal('mod-historial-producto');
};

// ---------------------------------------------------------------
// RENDER: INVENTARIO
// ---------------------------------------------------------------
function badgeStock(p) {
    const existencias = Number(p.Existencias) || 0;
    if (existencias <= 0) return `<span class="badge badge-red"><i class="fa-solid fa-circle-xmark"></i>Sin stock</span>`;
    return `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i>${existencias} en stock</span>`;
}

function badgeVencimiento(p) {
    if (!p.Fecha_Vencimiento) return '';
    const dias = daysUntil(p.Fecha_Vencimiento);
    if (dias === null) return '';
    if (dias < 0) return `<span class="badge badge-red"><i class="fa-solid fa-triangle-exclamation"></i>Vencido</span>`;
    if (dias <= 30) return `<span class="badge badge-amber"><i class="fa-solid fa-hourglass-half"></i>Vence en ${dias}d</span>`;
    return `<span class="badge badge-gray"><i class="fa-solid fa-calendar"></i>${fmtDate(p.Fecha_Vencimiento)}</span>`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

window.renderInventario = () => {
    const term = (document.getElementById('inv-search').value || '').toLowerCase().trim();
    const grid = document.getElementById('inv-grid');
    const empty = document.getElementById('inv-empty');

    const productos = (DB.Productos || []).filter(p => {
        if (!term) return true;
        return (p.Nombre || '').toLowerCase().includes(term) || (p.Proveedor || '').toLowerCase().includes(term);
    }).sort((a, b) => (a.Nombre || '').localeCompare(b.Nombre || ''));

    grid.innerHTML = '';
    empty.classList.toggle('hidden', productos.length > 0);

    productos.forEach(p => {
        const thumb = p.Imagen_Base64
            ? `<img src="${p.Imagen_Base64}" class="product-thumb" alt="${escapeHtml(p.Nombre || '')}">`
            : `<div class="product-thumb-placeholder"><i class="fa-solid fa-box"></i></div>`;

        grid.insertAdjacentHTML('beforeend', `
            <div class="product-card animate-fade">
                ${thumb}
                <div class="p-4">
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <h4 class="font-bold text-primary leading-tight">${escapeHtml(p.Nombre || '')}</h4>
                    </div>
                    <div class="flex flex-wrap gap-1.5 mb-3">
                        ${badgeStock(p)}
                        ${badgeVencimiento(p)}
                    </div>
                    <div class="flex items-center justify-between text-sm mb-1">
                        <span class="text-gray-400">Costo</span>
                        <span class="font-semibold text-primary">${fmtMoney(p.Costo)}</span>
                    </div>
                    <div class="flex items-center justify-between text-sm mb-3">
                        <span class="text-gray-400">Precio venta</span>
                        <span class="font-bold text-accent">${fmtMoney(p.Precio_Venta)}</span>
                    </div>
                    ${p.Proveedor ? `<p class="text-xs text-gray-400 mb-3 truncate"><i class="fa-solid fa-truck-fast mr-1"></i>${escapeHtml(p.Proveedor)}${p.Proveedor_Telefono ? ' · ' + escapeHtml(p.Proveedor_Telefono) : ''}</p>` : ''}
                    <div class="flex items-center gap-2 pt-2 border-t border-gray-100">
                        <button onclick="openRestockModal('${p.ID_Producto}')" class="admin-only flex-1 btn-ghost !py-2 text-xs flex items-center justify-center gap-1"><i class="fa-solid fa-box-open"></i>Reabastecer</button>
                        <button onclick="verHistorialProducto('${p.ID_Producto}')" class="w-9 h-9 shrink-0 rounded-lg bg-gray-100 hover:bg-gray-200 text-primary flex items-center justify-center" title="Historial"><i class="fa-solid fa-clock-rotate-left text-sm"></i></button>
                        <button onclick="openEditProducto('${p.ID_Producto}')" class="admin-only w-9 h-9 shrink-0 rounded-lg bg-gray-100 hover:bg-gray-200 text-primary flex items-center justify-center" title="Editar"><i class="fa-solid fa-pen text-sm"></i></button>
                    </div>
                </div>
            </div>
        `);
    });
};

// ---------------------------------------------------------------
// RENDER: DASHBOARD
// ---------------------------------------------------------------
window.renderDashboard = () => {
    const productos = DB.Productos || [];
    const sinStock = productos.filter(p => (Number(p.Existencias) || 0) <= 0);
    const porVencer = productos
        .filter(p => p.Fecha_Vencimiento && daysUntil(p.Fecha_Vencimiento) !== null && daysUntil(p.Fecha_Vencimiento) <= 30)
        .sort((a, b) => daysUntil(a.Fecha_Vencimiento) - daysUntil(b.Fecha_Vencimiento));
    const valorVenta = productos.reduce((acc, p) => acc + (Number(p.Precio_Venta) || 0) * (Number(p.Existencias) || 0), 0);

    document.getElementById('kpi-total-productos').innerText = productos.length;
    document.getElementById('kpi-sin-stock').innerText = sinStock.length;
    document.getElementById('kpi-por-vencer').innerText = porVencer.length;
    document.getElementById('kpi-valor-venta').innerText = fmtMoney(valorVenta);

    const vencWrap = document.getElementById('dash-vencimientos');
    const vencEmpty = document.getElementById('dash-vencimientos-empty');
    vencWrap.innerHTML = '';
    vencEmpty.classList.toggle('hidden', porVencer.length > 0);
    porVencer.slice(0, 6).forEach(p => {
        const dias = daysUntil(p.Fecha_Vencimiento);
        vencWrap.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center"><i class="fa-solid fa-box"></i></div>
                    <div>
                        <p class="text-sm font-bold text-primary">${escapeHtml(p.Nombre || '')}</p>
                        <p class="text-xs text-gray-400">${fmtDate(p.Fecha_Vencimiento)}</p>
                    </div>
                </div>
                ${dias < 0 ? `<span class="badge badge-red">Vencido</span>` : `<span class="badge badge-amber">${dias}d</span>`}
            </div>
        `);
    });

    const recWrap = document.getElementById('dash-recientes');
    const recEmpty = document.getElementById('dash-recientes-empty');
    const recientes = (DB.Historial_Reabastecimiento || []).slice().sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || '')).slice(0, 6);
    recWrap.innerHTML = '';
    recEmpty.classList.toggle('hidden', recientes.length > 0);
    recientes.forEach(r => {
        recWrap.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between">
                <div class="min-w-0">
                    <p class="text-sm font-bold text-primary truncate">${escapeHtml(r.Producto_Nombre || '')}</p>
                    <p class="text-xs text-gray-400">${r.Fecha || ''}</p>
                </div>
                <span class="text-sm font-black text-emerald-600 shrink-0">+${r.Cantidad}</span>
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

    const registros = (DB.Historial_Reabastecimiento || []).filter(r => {
        if (!term) return true;
        return (r.Producto_Nombre || '').toLowerCase().includes(term) || (r.Proveedor || '').toLowerCase().includes(term);
    }).sort((a, b) => (b.Fecha || '').localeCompare(a.Fecha || ''));

    tbody.innerHTML = '';
    empty.classList.toggle('hidden', registros.length > 0);

    registros.forEach(r => {
        tbody.insertAdjacentHTML('beforeend', `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-gray-500 whitespace-nowrap">${r.Fecha || ''}</td>
                <td class="px-4 py-3 font-semibold text-primary">${escapeHtml(r.Producto_Nombre || '')}</td>
                <td class="px-4 py-3 text-right font-bold text-emerald-600">+${r.Cantidad}</td>
                <td class="px-4 py-3 text-gray-500">${escapeHtml(r.Proveedor || '—')}</td>
                <td class="px-4 py-3 text-right text-gray-500">${r.Costo_Unitario ? fmtMoney(r.Costo_Unitario) : '—'}</td>
                <td class="px-4 py-3 text-gray-500">${escapeHtml(r.Usuario || '—')}</td>
                <td class="px-4 py-3 text-gray-400">${escapeHtml(r.Notas || '')}</td>
            </tr>
        `);
    });
};
