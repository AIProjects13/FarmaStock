        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
        import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
        import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

        // CONFIGURAR FIREBASE AQUÍ?
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
        
        // URL DE APPS SCRIPT DESPLEGADO
        const APP_BUILD = "2026-08-03-rastro";
        console.log("%cFarmacia OS — build " + APP_BUILD, "background:#0B192C;color:#00D1FF;padding:2px 6px;border-radius:3px;font-weight:bold");
        const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzpNV1r9KsKVzAlNwl3KH4aCjzDY1p4rPnNkmLmkJHvaJuCRlU6-HjI6dpppJZCBj4T/exec"; 

        // ESTADO GLOBAL
        let DB = { Productos:[], Categorias:[], Paquetes:[], Ventas_Facturas:[], Gastos:[], Tickets_Tareas:[], Configuracion:[], Auditoria_Logs:[], Usuarios:[], Asistencia_Usuarios:[], Inventario_Compras:[], Caja_Mensual:[] };
        let currentUser = null; // Email Firebase
        let activeAppUser = null; // Usuario seleccionado (PIN)
        let userRole = 'user'; // HALLAZGO 1: Rol definido temprano (admin o user)
        let cart = [];
        let dashFilter = 'hoy';
        let chartIncludeIngresos = true;
        let chartIncludeGastos = true;
        let mainChartInstance = null;
        let activePosCategory = 'PAQUETES'; // Iniciar por defecto en paquetes

        // HALLAZGO 1: Funciones de validación de rol
        const getRolUsuario = window.getRolUsuario = () => userRole || 'user';
        const puedeEjecutar = window.puedeEjecutar = (accion, rol = null) => {
            const r = rol || getRolUsuario();
            const permisos = {
                admin: ['crear_producto', 'editar_producto', 'crear_usuario', 'editar_usuario', 'cierre_caja', 'ver_reportes', 'crear_paquete', 'procesar_anulacion'],
                user: ['crear_venta', 'ver_carrito']
            };
            return (permisos[r] || []).includes(accion);
        };

        window.toggleChartSource = () => {
            const chkIngresos = document.getElementById('chk-ingresos');
            const chkGastos = document.getElementById('chk-gastos');
            if(chkIngresos) chartIncludeIngresos = chkIngresos.checked;
            if(chkGastos) chartIncludeGastos = chkGastos.checked;
            renderDashboard();
        };

        // Nombre de usuario dinámico para Logs y Timestamps
        const getActiveUserName = () => activeAppUser ? `${activeAppUser.Nombre} ${activeAppUser.Apellido}` : (currentUser || 'Sistema');

        // HALLAZGO 11: Función centralizada para detectar venta fraccionada
        const esVentaFraccionada = window.esVentaFraccionada = (item) => {
            return item && (item.isFraction === true || item.isFraccion === true || item.Venta_Fraccionada === true);
        };

        // HALLAZGO 9: Función para generar IDs únicos con sufijo aleatorio
        const generarIdUnico = window.generarIdUnico = (prefijo) => {
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substr(2, 9);
            return `${prefijo}${timestamp}-${randomSuffix}`;
        };

        // GATEKEEPER - Bloqueo de acciones sin usuario activo
        const checkUserActive = window.checkUserActive = () => {
            if (userRole === 'admin') return true;
            if (!activeAppUser) {
                if (DB.Usuarios && DB.Usuarios.length > 0) {
                    showToast("Por favor selecciona un turno activo (PIN) para continuar.", "error");
                    openModal('mod-pin');
                } else {
                    showToast("Debes crear un Usuario en la pestaña Ajustes primero.", "error");
                    if (userRole === 'admin') document.querySelector('[data-target="tab-set"]').click();
                }
                return false;
            }
            return true;
        };

        // UTILIDADES UI
        const showToast = window.showToast = (msg, type = 'success') => {
            const t = document.getElementById('toast');
            document.getElementById('toast-msg').innerText = msg;
            document.getElementById('toast-icon').className = type === 'error' ? 'fa-solid fa-circle-xmark text-red-500' : 'fa-solid fa-circle-check text-accent';
            t.classList.remove('translate-y-24', 'opacity-0');
            setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), type === 'error' ? 5000 : 3000);
        };
        const togglePassword = window.togglePassword = () => {
            const p = document.getElementById('auth-password');
            p.type = p.type === 'password' ? 'text' : 'password';
        };
        const openModal = window.openModal = id => { 
            // Control de acceso para modales restringidos
            const restricted = ['mod-producto', 'mod-categoria', 'mod-checkout', 'mod-paquete', 'mod-gasto', 'mod-ticket'];
            if (restricted.includes(id) && !checkUserActive()) return;

            if(id === 'mod-pin' && (!DB.Usuarios || DB.Usuarios.length === 0)) return showToast("Debes crear un usuario en Ajustes primero.", "error");
            if(id === 'mod-pin') populatePinUsers();
            document.getElementById(id).classList.add('open'); document.getElementById(id).classList.remove('hidden-view'); 
        };
        const closeModal = window.closeModal = id => { document.getElementById(id).classList.remove('open'); setTimeout(() => document.getElementById(id).classList.add('hidden-view'),300); };
        const setInvSub = window.setInvSub = (id) => {
            document.querySelectorAll('.inv-view').forEach(e => e.classList.add('hidden-view'));
            document.querySelectorAll('.inv-sub').forEach(e => e.classList.replace('text-primary','text-gray-400') || e.classList.remove('border-b-2','border-primary'));
            document.getElementById(`inv-${id}`).classList.remove('hidden-view');
            event.target.classList.replace('text-gray-400','text-primary');
            event.target.classList.add('border-b-2','border-primary');
        };

        window.addEventListener('error', (event) => {
            console.error("Global Error:", event.error);
            showToast(`Error: ${event.message}`, 'error');
        });
        
        window.addEventListener('unhandledrejection', (event) => {
            console.error("Unhandled Promise Rejection:", event.reason);
            showToast(`Error (Promise): ${event.reason}`, 'error');
        });

        const setLoading = (state) => {
            const l = document.getElementById('loader');
            if (l) { state ? l.classList.remove('hidden-view') : l.classList.add('hidden-view'); }
            
            if (!state) {
                const gl = document.getElementById('global-loader');
                if (gl) {
                    gl.style.opacity = '0';
                    setTimeout(() => { gl.style.display = 'none'; }, 500);
                }
            }
        };

        const fMoney = n => 'Q ' + Number(n||0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        const sysTime = window.sysTime = (dateOnly = false) => {
            const d = new Date();
            const gt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Guatemala' }));
            const DD = String(gt.getDate()).padStart(2, '0');
            const MM = String(gt.getMonth() + 1).padStart(2, '0');
            const YYYY = gt.getFullYear();
            if (dateOnly) return `${YYYY}-${MM}-${DD}`;
            const hh = String(gt.getHours()).padStart(2, '0');
            const mm = String(gt.getMinutes()).padStart(2, '0');
            const ss = String(gt.getSeconds()).padStart(2, '0');
            return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
        };

        const formatDisplayDate = window.formatDisplayDate = (isoStr) => {
            if(!isoStr) return '--';
            const s = String(isoStr);
            if(s.includes('T')) {
                const d = new Date(s);
                if(!isNaN(d)) {
                    const DD = String(d.getDate()).padStart(2, '0');
                    const MM = String(d.getMonth() + 1).padStart(2, '0');
                    const YYYY = d.getFullYear();
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    const ss = String(d.getSeconds()).padStart(2, '0');
                    return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
                }
            }
            return s;
        };

        // ==========================================================
        // === CAJA_CORE_START ===
        // Logica pura (sin DOM) compartida por el panel de efectivo, el
        // dashboard, la grafica y las pruebas de tests/caja.test.js.
        // No uses document ni window dentro de este bloque.
        // ==========================================================
        const toNum = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

        const parseDateToInt = (dateStr) => {
            if (!dateStr) return 0;
            let s = String(dateStr).trim();

            // Extract Time
            let timeStr = '000000';
            if (s.includes(' ')) {
                const tParts = s.split(' ')[1].split(':');
                if (tParts.length >= 2) {
                    timeStr = `${(tParts[0]||'00').padStart(2,'0')}${(tParts[1]||'00').padStart(2,'0')}${((tParts[2]||'00').split('.')[0]||'00').padStart(2,'0')}`;
                }
            } else if (s.includes('T')) {
                const tParts = s.split('T')[1].split(':');
                if (tParts.length >= 2) {
                    timeStr = `${(tParts[0]||'00').padStart(2,'0')}${(tParts[1]||'00').padStart(2,'0')}${((tParts[2]||'00').split('.')[0]||'00').padStart(2,'0')}`;
                }
            }

            if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return parseInt(s.replace(/-/g, '') + timeStr);
            if (s.includes('T')) s = s.split('T')[0];

            const parts = s.split(' ')[0].split(/[\/-]/);
            if (parts.length === 3) {
                let y = parts[2], m = parts[1], d = parts[0];
                if (parts[0].length === 4) { y = parts[0]; m = parts[1]; d = parts[2]; }
                else if (parts[2].length === 2) { y = '20' + parts[2]; }
                return parseInt(`${y}${m.padStart(2,'0')}${d.padStart(2,'0')}${timeStr}`);
            }
            return 0;
        };

        // Un recibo anulado no es venta: no suma a caja, ni a ventas, ni a ganancia.
        const ventaEsAnulada = (f) => String((f && f.Estatus) || '').trim().toLowerCase() === 'cancelado';

        // Solo el efectivo entra a la caja. Tarjeta y transferencia van al banco.
        const ventaEsEfectivo = (f) => {
            const m = String((f && f.Metodo_Pago) || 'Efectivo').trim().toLowerCase();
            return m === '' || m === 'efectivo';
        };

        // Costo de mercancia de una factura (expande paquetes y fracciones)
        const costoDeVenta = (db, factura) => {
            let costo = 0;
            let items = [];
            try { items = JSON.parse(factura.Items_JSON || '[]'); } catch(e) { return 0; }

            items.forEach(i => {
                let costoUnitario = 0;
                if (i.isPaquete || i.isCombo) {
                    const pk = (db.Paquetes || []).find(p => p.ID_Paquete === i.id);
                    if (pk) {
                        let sub = [];
                        try { sub = JSON.parse(pk.Productos_JSON || '[]'); } catch(e) {}
                        sub.forEach(si => {
                            const rp = (db.Productos || []).find(p => p.ID_Producto === si.id);
                            if (rp) costoUnitario += toNum(rp.Costo_Compra) * toNum(si.cantidad);
                        });
                    }
                } else {
                    const pr = (db.Productos || []).find(p => p.ID_Producto === i.id);
                    if (pr) costoUnitario = toNum(pr.Costo_Compra);
                }

                let cant = toNum(i.cantidad);
                // HALLAZGO 11: Usar función centralizada para detectar venta fraccionada
                if (esVentaFraccionada(i)) {
                    const pr = (db.Productos || []).find(p => p.ID_Producto === i.id);
                    if (pr && toNum(pr.Fraccion_Cant) > 0) cant = cant / toNum(pr.Fraccion_Cant);
                }
                costo += costoUnitario * cant;
            });
            return costo;
        };

        // Unidades de un producto que YA quedaron registradas como Gasto de mercancia.
        // Se busca por el codigo [ID: XXX] porque el nombre puede cambiar.
        const unidadesYaRegistradas = (db, prod) => {
            const tag = '[ID: ' + prod.ID_Producto + ']';
            let qty = 0;
            (db.Gastos || []).forEach(g => {
                if (String(g.Tipo || '') !== 'Mercanc\u00eda') return;
                const c = String(g.Concepto || '');
                if (c.indexOf(tag) === -1) return;
                const m = c.match(/\((\d+(?:\.\d+)?)\s*unds\)/);
                if (m) qty += toNum(m[1]);
            });
            return qty;
        };

        // Costo del inventario que entro sin dejar un Gasto (productos historicos).
        // Evita contar dos veces la mercancia que si tiene su Gasto registrado.
        const costoMercanciaSinRegistrar = (db, prod) => {
            let vendidas = 0;
            (db.Ventas_Facturas || []).forEach(f => {
                if (ventaEsAnulada(f)) return;
                try {
                    JSON.parse(f.Items_JSON || '[]').forEach(i => {
                        if (i.id === prod.ID_Producto) vendidas += toNum(i.cantidad);
                    });
                } catch(e) {}
            });
            const compradas = toNum(prod.Existencias) + vendidas;
            const faltantes = compradas - unidadesYaRegistradas(db, prod);
            return faltantes > 0 ? faltantes * toNum(prod.Costo_Compra) : 0;
        };

        // ---- EFECTIVO EN CAJA ----------------------------------------------
        // Punto de partida = ultimo cierre de caja. Si nunca se ha hecho uno,
        // se usa la base inicial que configura el dueno en Finanzas.
        // Saldo = punto de partida + ventas en efectivo - gastos.
        const calcularEstadoCaja = (db, opts) => {
            opts = opts || {};
            const cierres = (db.Caja_Mensual || []).slice()
                .sort((a, b) => parseDateToInt(a.fecha_registro) - parseDateToInt(b.fecha_registro));
            const ultimo = cierres.length ? cierres[cierres.length - 1] : null;

            // Manda el punto de partida MAS RECIENTE. Normalmente es el ultimo cierre,
            // pero si el dueno ajusta la base con una fecha posterior, esa base gana:
            // asi puede volver a arrancar el conteo despues de cargar el inventario
            // sin tener que inventar un cierre falso.
            const fechaCierre = ultimo ? parseDateToInt(ultimo.fecha_registro) : 0;
            const fechaBase = parseDateToInt(opts.fechaBase || '');
            const mandaElCierre = !!ultimo && fechaCierre >= fechaBase;

            let ancla, anclaFecha, anclaEtiqueta;
            if (mandaElCierre) {
                const sf = ultimo.saldo_final;
                ancla = (sf === undefined || sf === null || sf === '')
                    ? toNum(ultimo.total_recaudado) - toNum(ultimo.efectivo_entregado)
                    : toNum(sf);
                anclaFecha = ultimo.fecha_registro || '';
                anclaEtiqueta = 'Qued\u00f3 del \u00faltimo cierre';
            } else {
                ancla = toNum(opts.baseInicial);
                anclaFecha = opts.fechaBase || '';
                anclaEtiqueta = 'Base inicial';
            }

            const desdeN = parseDateToInt(anclaFecha);
            let ventasEfectivo = 0, ventasOtros = 0, gastos = 0, gananciaBruta = 0;

            (db.Ventas_Facturas || []).forEach(f => {
                if (ventaEsAnulada(f)) return;
                if (desdeN && parseDateToInt(f.Fecha) <= desdeN) return;
                const total = toNum(f.Total_Pagar);
                if (ventaEsEfectivo(f)) ventasEfectivo += total; else ventasOtros += total;
                gananciaBruta += total - costoDeVenta(db, f);
            });

            (db.Gastos || []).forEach(g => {
                if (desdeN && parseDateToInt(g.Fecha) <= desdeN) return;
                // SOLO contar gastos que fueron dinero real de caja
                // Los gastos de "Ingreso de inventario" tienen Fue_De_Caja = NO o vacío
                if (String(g.Fue_De_Caja).trim().toUpperCase() === 'SI' || g.Fue_De_Caja === 1 || g.Fue_De_Caja === true) {
                    gastos += toNum(g.Monto);
                }
            });

            return {
                ancla: ancla,
                anclaFecha: anclaFecha,
                anclaEtiqueta: anclaEtiqueta,
                ventasEfectivo: ventasEfectivo,
                ventasOtros: ventasOtros,
                gastos: gastos,
                gananciaBruta: gananciaBruta,
                saldo: ancla + ventasEfectivo - gastos,
                hayBase: !!ultimo || toNum(opts.baseInicial) !== 0 || !!opts.fechaBase,
                mandaElCierre: mandaElCierre,
                cierres: cierres.length
            };
        };
        // === CAJA_CORE_END ===

        window.parseDateToInt = parseDateToInt;
        window.calcularEstadoCaja = calcularEstadoCaja;

        // Filtro de rango de fechas reutilizable (Finanzas y exportaciones CSV)
        const makeDateFilter = (desde, hasta) => {
            const soloDia = (v) => { let n = parseDateToInt(v); return n > 99999999 ? Math.floor(n / 1000000) : n; };
            const dsN = soloDia(desde), deN = soloDia(hasta);
            return (dStr) => {
                if (!dsN && !deN) return true;
                const dN = soloDia(dStr);
                if (!dN) return false;
                if (dsN && deN) return dN >= dsN && dN <= deN;
                if (dsN) return dN >= dsN;
                return dN <= deN;
            };
        };

        // Descarga de CSV (una sola implementacion para todos los reportes)
        const downloadCSV = (nombreArchivo, contenido) => {
            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), contenido], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `${nombreArchivo}_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        };
        
        async function apiCall(action, payload = {}, forceRefresh = false) {
            payload.action = action;
            payload.user = getActiveUserName();

            if (!auth.currentUser) throw new Error("SERVER_ERROR: Usuario no autenticado en Firebase.");
            try {
                payload.token = await auth.currentUser.getIdToken(forceRefresh);
            } catch(e) {
                throw new Error("SERVER_ERROR: Fallo al obtener el token de seguridad.");
            }

            payload.role = userRole; // OPCIÓN A: Enviar rol al backend para validación
            payload._id = Date.now() + Math.random().toString(36).substr(2, 9);
            try {
                const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
                const data = await res.json();
                
                if(data.status === 'error') {
                    if (data.message && data.message.includes("ACCESO DENEGADO") && !forceRefresh) {
                        return await apiCall(action, payload, true);
                    }
                    throw new Error('SERVER_ERROR: ' + data.message);
                }
                return data;
            } catch (e) {
                if (e.message && e.message.startsWith('SERVER_ERROR:')) {
                    showToast(e.message.replace('SERVER_ERROR: ', ''), 'error');
                    throw e;
                } else {
                    enqueueRequest(payload);
                    showToast('Sin conexión. Guardado localmente.', 'info');
                }
                return null;
            }
        }

        // Diagnostico manual: escribir probarConexion() en la consola (F12).
        // Prueba LEER y ESCRIBIR por separado y muestra la respuesta cruda.
        window.probarConexion = async () => {
            const jwt = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
            console.log('%c--- PRUEBA DE CONEXION ---', 'font-weight:bold');

            // LECTURA (GET)
            try {
                const t0 = Date.now();
                const r1 = await fetch(`${SCRIPT_URL}?sheetName=all&_cb=${Date.now()}&token=${encodeURIComponent(jwt)}`);
                const txt1 = await r1.text();
                console.log('LECTURA  →', r1.status, 'en', ((Date.now()-t0)/1000).toFixed(1) + 's,', txt1.length, 'caracteres');
                console.log('   empieza con:', txt1.substring(0, 120));
            } catch(e) { console.error('LECTURA  → falló:', e.message); }

            // ESCRITURA (POST)
            try {
                const t0 = Date.now();
                const r2 = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'updateConfig', token: jwt, configData: { PruebaConexion: new Date().toISOString() } })
                });
                const txt2 = await r2.text();
                console.log('ESCRITURA →', r2.status, 'en', ((Date.now()-t0)/1000).toFixed(1) + 's');
                console.log('   respuesta:', txt2.substring(0, 300));
                if (r2.ok && txt2.indexOf('success') > -1) {
                    console.log('%c   ESCRITURA OK: revisá la pestaña Configuracion, debe aparecer PruebaConexion', 'color:green;font-weight:bold');
                } else {
                    console.log('%c   LA ESCRITURA FALLÓ. Copiá todo esto y mandalo.', 'color:red;font-weight:bold');
                }
            } catch(e) { console.error('ESCRITURA → falló:', e.message); }
        };

        function enqueueRequest(payload) {
            let q = JSON.parse(localStorage.getItem('farmacia_offline_queue') || '[]');
            q.push(payload);
            localStorage.setItem('farmacia_offline_queue', JSON.stringify(q));
            updateOfflineBadge(q.length);
        }

        // Maximo de reintentos por pendiente. Sin este tope, una peticion que
        // el servidor nunca acepta se reintenta en cada sincronizacion, se forma
        // en la fila de Google y hace que la carga tarde minutos. Es lo que
        // convertia dos pendientes atascados en una app lentisima.
        const MAX_INTENTOS_COLA = 3;
        let colaEnCurso = false;

        async function processOfflineQueue() {
            if (colaEnCurso) return; // nunca dos pasadas al mismo tiempo
            let q = [];
            try { q = JSON.parse(localStorage.getItem('farmacia_offline_queue') || '[]'); } catch(e) { localStorage.setItem('farmacia_offline_queue', '[]'); }
            if (!Array.isArray(q) || q.length === 0) {
                updateOfflineBadge(0);
                return;
            }

            colaEnCurso = true;
            let pendingQueue = [];
            let descartados = 0;

            for (let i = 0; i < q.length; i++) {
                const item = q[i];
                try {
                    const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(item) });
                    if (!res.ok) throw new Error("Error HTTP " + res.status);
                    const data = await res.json();
                    if(data.status === 'error') {
                        console.error("Error lógico en backend para request:", item, data.message);
                    }
                } catch(e) {
                    item._intentos = (item._intentos || 0) + 1;
                    if (item._intentos >= MAX_INTENTOS_COLA) {
                        console.error('Pendiente descartado tras ' + item._intentos + ' intentos:', item);
                        descartados++;
                    } else {
                        pendingQueue.push(item);
                    }
                }
            }

            localStorage.setItem('farmacia_offline_queue', JSON.stringify(pendingQueue));
            updateOfflineBadge(pendingQueue.length);
            colaEnCurso = false;

            if (descartados) {
                showToast(descartados + ' cambio(s) no se pudieron guardar en la nube y se descartaron. Revisá que estén bien en la hoja.', 'error');
            }
        }

        function updateOfflineBadge(count) {
            let badge = document.getElementById('offline-badge');
            if(!badge) {
                badge = document.createElement('div');
                badge.id = 'offline-badge';
                badge.className = 'fixed bottom-4 right-4 bg-orange-500 hover:bg-orange-600 cursor-pointer text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg z-[9999] transition-opacity';
                badge.title = "Clic para borrar tareas atascadas";
                badge.onclick = function() {
                    if(confirm('¿Desea borrar las tareas atascadas en la cola?')) {
                        localStorage.removeItem('farmacia_offline_queue');
                        this.style.opacity = '0';
                        setTimeout(() => location.reload(), 500);
                    }
                };
                document.body.appendChild(badge);
            }
            badge.innerText = `Sincronizando... (${count})`;
            badge.style.opacity = count > 0 ? '1' : '0';
            if(count === 0) badge.style.pointerEvents = 'none';
            else badge.style.pointerEvents = 'auto';
        }

        const fetchFullHistory = window.fetchFullHistory = async () => {
            if(!confirm("Esto descargará todo el historial histórico desde el inicio. Puede tardar varios segundos. ¿Deseas continuar?")) return;
            showToast("Descargando historial completo...", "info");
            await syncData(false, false, true);
            showToast("Historial descargado con éxito.", "success");
            
            if (!document.getElementById('tab-fin').classList.contains('hidden-view')) renderFinanzas();
            if (!document.getElementById('tab-audit').classList.contains('hidden-view')) renderAudit();
        };

        // --- COPIA LOCAL DE RESPALDO -------------------------------------
        // Guarda la ultima carga buena. Si la nube falla al abrir la app,
        // se muestran estos datos en vez de dejar la pantalla vacia.
        const CACHE_KEY = 'farmacia_db_cache';

        const guardarCacheDB = (data) => {
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
            } catch(e) {
                // Si no cabe (localStorage lleno) no pasa nada: solo no habra respaldo.
                console.warn('No se pudo guardar la copia local:', e.message);
            }
        };

        const leerCacheDB = () => {
            try {
                const raw = localStorage.getItem(CACHE_KEY);
                if (!raw) return null;
                const c = JSON.parse(raw);
                return (c && c.data) ? c : null;
            } catch(e) { return null; }
        };

        const pausa = (ms) => new Promise(r => setTimeout(r, ms));

        const pintarDB = () => {
            if(!DB.Usuarios) DB.Usuarios = [];
            if(!DB.Inventario_Compras) DB.Inventario_Compras = [];
            applyConfig();
            renderAll();
            updateClientesDatalist();
            const gLoader = document.getElementById('global-loader');
            if (gLoader && gLoader.style.display !== 'none') {
                gLoader.style.opacity = '0';
                setTimeout(() => { gLoader.style.display = 'none'; }, 500);
            }
        };

        // Lee una respuesta y la convierte a JSON avisando si vino basura.
        const leerRespuesta = async (res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const texto = await res.text();
            try { return JSON.parse(texto); }
            catch(e) { throw new Error('El servidor respondió algo que no son datos (probablemente estaba ocupado)'); }
        };

        // Una sola peticion de lectura. Devuelve los datos o lanza error.
        //
        // POR QUE POST Y NO GET:
        // El token de Firebase mide como 1000 caracteres. Al colgarlo de la URL
        // (?token=...) la direccion se pasa de larga y Google responde 404 al
        // redirigir a googleusercontent. Por eso abrir el /exec a mano si servia
        // (URL corta) pero la app no. En POST el token va en el cuerpo y no hay
        // limite de largo. El GET queda de respaldo por si el backend todavia
        // no se actualizo.
        // UNA SOLA PETICION DE LECTURA.
        // Se probo pedir las pestañas en 3 grupos en paralelo y fue peor:
        // Google atiende las peticiones de esta cuenta de una en una, asi que
        // los grupos hacian fila entre ellos y ademas le quitaban el turno a
        // las ventas. La velocidad ahora viene del cache del backend, no de
        // partir la peticion.
        // HALLAZGO 6: Cambiar a POST para evitar URLs demasiado largas con token
        const pedirDatos = async (forceRefresh, fullHistory) => {
            let jwt = '';
            if (auth.currentUser) jwt = await auth.currentUser.getIdToken(forceRefresh);

            const payload = {
                action: 'readAll',
                token: jwt,
                fullHistory: fullHistory || false,
                role: userRole, // OPCIÓN A: Enviar rol al backend
                _cb: Date.now()
            };

            const res = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            return await leerRespuesta(res);
        };

        const syncData = window.syncData = async (silent = false, forceRefresh = false, fullHistory = false) => {
            if (!silent) setLoading(true);

            const INTENTOS = 3;
            let ultimoError = null;
            let refrescarToken = forceRefresh;

            for (let intento = 1; intento <= INTENTOS; intento++) {
                try {
                    const data = await pedirDatos(refrescarToken, fullHistory);

                    // Token vencido: se pide uno nuevo y se reintenta enseguida.
                    if (data.status === 'error' && data.message && data.message.includes('ACCESO DENEGADO')) {
                        if (!refrescarToken) { refrescarToken = true; continue; }
                        throw new Error(data.message);
                    }

                    if (data.status === 'success') {
                        DB = Object.assign(DB, data.data);
                        guardarCacheDB(data.data);
                        pintarDB();
                        const st = document.getElementById('sync-status');
                        st.classList.replace('text-gray-400', 'text-accent');
                        setTimeout(() => st.classList.replace('text-accent', 'text-gray-400'), 2000);

                        // La cola de pendientes se envia DESPUES de cargar, no al
                        // mismo tiempo: si van juntas compiten y se traban entre si.
                        processOfflineQueue().catch(e => console.error("Offline queue error:", e));

                        if (!silent) setLoading(false);
                        return true;
                    }

                    throw new Error(data.error || data.message || 'Respuesta inválida del servidor');

                } catch(e) {
                    ultimoError = e;
                    console.error(`Sync intento ${intento}/${INTENTOS} falló:`, e.message);
                    if (intento < INTENTOS) await pausa(700 * intento); // 0.7s, luego 1.4s
                }
            }

            // Se acabaron los intentos: se trabaja con la ultima copia buena.
            const cache = leerCacheDB();
            if (cache) {
                DB = Object.assign(DB, cache.data);
                pintarDB();
                if (!silent) {
                    const min = Math.round((Date.now() - cache.ts) / 60000);
                    showToast(`Sin conexión con la base. Mostrando la última copia guardada (hace ${min} min). Tocá el botón de sincronizar para reintentar.`, 'error');
                }
            } else if (!silent) {
                showToast('No se pudo cargar la información. Revisá tu internet y tocá el botón de sincronizar.', 'error');
            }

            console.error('Sync falló tras', INTENTOS, 'intentos:', ultimoError && ultimoError.message);
            if (!silent) setLoading(false);
            return false;
        };

        function applyConfig() {
            try {
                const cName = DB.Configuracion.find(c => c.Clave === 'StoreName')?.Valor || 'Farmacia OS';
                document.getElementById('login-store-name').innerText = cName;
                document.getElementById('sidebar-store-name').innerText = cName;
                document.getElementById('cfg-nombre').value = cName;
                document.title = cName;
            } catch(e) { console.error('Config Error', e); }
            
            try {
                const catSel = document.getElementById('prd-cat');
                catSel.innerHTML = '<option value="">Seleccione...</option>' + (DB.Categorias || []).map(c => `<option value="${c.ID_Categoria}">${c.Nombre_Categoria}</option>`).join('');
                
                const srchCat = document.getElementById('srch-cat');
                if(srchCat) {
                    srchCat.innerHTML = '<option value="">Todas las Categorías</option>' + (DB.Categorias || []).map(c => `<option value="${c.ID_Categoria}">${c.Nombre_Categoria}</option>`).join('');
                }

                const pkgSel = document.getElementById('pkg-sel-prod');
                pkgSel.innerHTML = (DB.Productos || []).map(p => `<option value="${p.ID_Producto}">${p.Nombre} - Stock: ${p.Existencias}</option>`).join('');
                
                const asigSel = document.getElementById('tk-asig');
                asigSel.innerHTML = '<option value="">Seleccione a quién asignar...</option>' + (DB.Usuarios || []).map(u => `<option value="${u.Nombre}">${u.Nombre}</option>`).join('');
            } catch(e) { console.error('Selects Error', e); }
        }

        function renderAll() {
            try { renderDashboard(); } catch(e) { console.error('Dashboard Error', e); }
            try { renderPosCategories(); renderPosCatalog(); checkLowStockCaja(); } catch(e) { console.error('POS Error', e); }
            try { renderProductos(); } catch(e) { console.error('Productos Error', e); }
            try { renderPaquetes(); } catch(e) { console.error('Paquetes Error', e); }
            try { renderCategorias(); } catch(e) { console.error('Categorias Error', e); }
            try { renderUsuarios(); } catch(e) { console.error('Usuarios Error', e); }
            try { renderFinanzas(); } catch(e) { console.error('Finanzas Error', e); }
            try { renderTickets(); } catch(e) { console.error('Tickets Error', e); }
            try { renderAudit(); } catch(e) { console.error('Audit Error', e); }
            try { renderCompras(); } catch(e) { console.error('Compras Error', e); }
        }

        // --- MANEJO DE USUARIOS Y PIN ---
        function populatePinUsers() {
            const s = document.getElementById('pin-sel-user');
            s.innerHTML = '<option value="">Selecciona tu usuario...</option>' + DB.Usuarios.map(u => `<option value="${u.ID_Usuario}">${u.Nombre} ${u.Apellido || ''}</option>`).join('');
            document.getElementById('pin-input').value = '';
            document.getElementById('pin-error').classList.add('hidden');
        }

        // HALLAZGO 2: Verificación de PIN con API backend
        const verifyPin = window.verifyPin = async () => {
            const uid = document.getElementById('pin-sel-user').value;
            const pin = document.getElementById('pin-input').value;
            if(!uid || !pin) return;

            // Primero intentar verificar con el backend (seguro)
            try {
                const verifyResult = await apiCall('verifyPin', { userID: uid, pin: pin });
                if (verifyResult && verifyResult.status === 'success') {
                    // PIN verificado en backend
                    const u = DB.Usuarios.find(x => x.ID_Usuario === uid);
                    if(u) {
                        activeAppUser = u;
                        document.getElementById('active-user-display').innerText = `${u.Nombre} ${u.Apellido || ''}`;
                        document.getElementById('pin-error').classList.add('hidden');
                        closeModal('mod-pin');

                        DB.Usuarios.forEach(user => user.Estado_Turno = (user.ID_Usuario === uid) ? 'Activo' : 'Pausado');
                        renderUsuarios();
                        logTime('Turno_Activo');
                    }
                } else {
                    document.getElementById('pin-error').classList.remove('hidden');
                }
            } catch(e) {
                // Si falla el backend, usar validación local como respaldo
                const u = DB.Usuarios.find(x => x.ID_Usuario === uid);
                if(u && String(u.PIN) === pin) {
                    activeAppUser = u;
                    document.getElementById('active-user-display').innerText = `${u.Nombre} ${u.Apellido || ''}`;
                    document.getElementById('pin-error').classList.add('hidden');
                    closeModal('mod-pin');

                    DB.Usuarios.forEach(user => user.Estado_Turno = (user.ID_Usuario === uid) ? 'Activo' : 'Pausado');
                    renderUsuarios();
                    logTime('Turno_Activo');
                } else {
                    document.getElementById('pin-error').classList.remove('hidden');
                }
            }
        };

        const pauseActiveUser = window.pauseActiveUser = () => {
            if(!activeAppUser) return;
            logTime('Inicio_Descanso');
            activeAppUser = null;
            document.getElementById('active-user-display').innerText = 'Ninguno (Seleccionar)';
            DB.Usuarios.forEach(user => user.Estado_Turno = 'Pausado');
            renderUsuarios();
        };

        const saveUsuarioInline = window.saveUsuarioInline = async (event) => {
            event.preventDefault();
            const nombre = document.getElementById('usr-nombre-inline').value.trim();
            const pin = document.getElementById('usr-pin-inline').value.trim();
            if(!nombre || pin.length < 4) return showToast("Llene el nombre y un PIN de 4 dígitos", "error");

            // HALLAZGO 9: Usar generador de ID único
            const id = generarIdUnico('USR-');
            const data = {
                ID_Usuario: id,
                Nombre: nombre,
                Apellido: '',
                Rol: 'user',
                Fecha_Nacimiento: '',
                PIN: pin,
                Estado_Turno: 'Pausado',
                Creado_En: sysTime()
            };

            setLoading(true);
            const res = await apiCall('crud', { sheetName: 'Usuarios', operation: 'create', rowData: data, idField: 'ID_Usuario', idValue: id });
            logAudit('Usuarios', 'Crear/Editar Usuario', `Usuario: ${data.Nombre} [${id}]`);
            setLoading(false);
            
            if(res) {
                DB.Usuarios.push(data);
                renderUsuarios();
                document.getElementById('usr-nombre-inline').value = '';
                document.getElementById('usr-pin-inline').value = '';
                showToast("Usuario Creado Exitosamente");
            }
        };

        window.saveUsuario = async () => {
            // HALLAZGO 9: Usar generador de ID único
            const id = document.getElementById('usr-id').value || generarIdUnico('USR-');
            const data = {
                ID_Usuario: id, Nombre: document.getElementById('usr-nombre').value,
                Apellido: document.getElementById('usr-apellido').value, Fecha_Nacimiento: document.getElementById('usr-dob')?.value || '',
                PIN: document.getElementById('usr-pin').value, Estado_Turno: 'Pausado', Creado_En: sysTime()
            };
            if(!data.Nombre || !data.Apellido || data.PIN.length < 4) return showToast("Llene los datos y un PIN 4 dígitos válido", "error");

            setLoading(true);
            const res = await apiCall('crud', { sheetName: 'Usuarios', operation: document.getElementById('usr-id').value?'update':'create', rowData: data, idField: 'ID_Usuario', idValue: id });
            logAudit('Usuarios', 'Crear/Editar Usuario', `Usuario: ${data.Nombre} [${id}]`);
            setLoading(false);
            
            if(res) {
                const idx = DB.Usuarios.findIndex(x => x.ID_Usuario === id);
                if (idx > -1) DB.Usuarios[idx] = data; else DB.Usuarios.push(data);
                renderUsuarios(); applyConfig(); closeModal('mod-usuario'); showToast("Usuario Guardado");
            }
        };

        const editUsuario = window.editUsuario = (id) => {
            if(!checkUserActive()) return;
            const u = DB.Usuarios.find(x => x.ID_Usuario === id);
            document.getElementById('usr-id').value = id;
            document.getElementById('usr-nombre').value = u.Nombre;
            document.getElementById('usr-apellido').value = u.Apellido;
            const dobEl = document.getElementById('usr-dob'); if (dobEl) dobEl.value = u.Fecha_Nacimiento || '';
            document.getElementById('usr-pin').value = u.PIN;
            document.getElementById('mod-usr-title').innerText = "Editar Usuario";
            openModal('mod-usuario');
        };

        const deleteUsuario = window.deleteUsuario = async (id) => {
            if(!checkUserActive()) return;
            if(!confirm("¿Eliminar usuario permanentemente?")) return;
            DB.Usuarios = DB.Usuarios.filter(x => x.ID_Usuario !== id);
            if(activeAppUser && activeAppUser.ID_Usuario === id) pauseActiveUser();
            renderUsuarios(); applyConfig(); showToast("Usuario Eliminado");
            apiCall('crud', { sheetName: 'Usuarios', operation: 'delete', idField: 'ID_Usuario', idValue: id });
            logAudit('Usuarios', 'Eliminar Usuario', `Usuario ID: ${id}`);
        };

        function renderUsuarios() {
            const lst = document.getElementById('lst-users'); lst.innerHTML = '';
            (DB.Usuarios || []).forEach(u => {
                const isActive = u.Estado_Turno === 'Activo';
                lst.innerHTML += `<div class="inline-flex justify-between items-center bg-gray-50 p-2 px-3 rounded-lg border border-gray-200 min-w-[200px] flex-auto max-w-sm">
                    <div>
                        <p class="font-bold text-primary text-sm">${u.Nombre} ${u.Apellido || ''} ${isActive ? '<span class="ml-1 px-1.5 py-0.5 bg-accent text-[10px] text-primary rounded uppercase">Activo</span>' : ''}</p>
                        <p class="text-[10px] text-gray-400 mt-0.5">PIN: ****</p>
                    </div>
                    <div class="flex gap-2 ml-4">
                        <button onclick="editUsuario('${u.ID_Usuario}')" class="text-blue-500 hover:text-blue-700 transition"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteUsuario('${u.ID_Usuario}')" class="text-red-500 hover:text-red-700 transition"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`;
            });
            if(!DB.Usuarios || !DB.Usuarios.length) lst.innerHTML = '<p class="text-sm text-gray-400 w-full text-center mt-4">No hay usuarios registrados.</p>';
        }


        // --- DASHBOARD LOGIC ---
        const setDashFilter = window.setDashFilter = (f) => {
            dashFilter = f;
            document.querySelectorAll('.dash-flt').forEach(b => {
                b.classList.replace('bg-primary', 'bg-gray-200'); b.classList.replace('text-white', 'text-primary');
            });
            event.target.classList.replace('bg-gray-200', 'bg-primary'); event.target.classList.replace('text-primary', 'text-white');
            document.querySelectorAll('.dash-lbl').forEach(l => l.innerText = f.charAt(0).toUpperCase() + f.slice(1));
            renderDashboard();
        };
        function isDateInPeriod(dStr, p) {
            if(!dStr) return false;
            let dN = parseDateToInt(dStr);
            if (!dN) return false;
            if (dN > 99999999) dN = Math.floor(dN / 1000000);
            
            const todayStr = sysTime(true);
            let todayN = parseDateToInt(todayStr);
            if (todayN > 99999999) todayN = Math.floor(todayN / 1000000);
            
            if(p==='hoy') return dN === todayN;
            if(p==='mes') return Math.floor(dN / 100) === Math.floor(todayN / 100);
            if(p==='semana') {
                const t = new Date();
                const w = new Date(t); w.setDate(t.getDate()-t.getDay());
                let weekStartN = parseDateToInt(`${String(w.getDate()).padStart(2,'0')}/${String(w.getMonth()+1).padStart(2,'0')}/${w.getFullYear()}`);
                if (weekStartN > 99999999) weekStartN = Math.floor(weekStartN / 1000000);
                return dN >= weekStartN && dN <= todayN;
            }
            if(p==='custom') {
                const ds = document.getElementById('dash-date-start')?.value || '';
                const de = document.getElementById('dash-date-end')?.value || '';
                let dsN = parseDateToInt(ds);
                let deN = parseDateToInt(de);
                if (dsN > 99999999) dsN = Math.floor(dsN / 1000000);
                if (deN > 99999999) deN = Math.floor(deN / 1000000);
                
                if(!dsN && !deN) return true;
                if(dsN && deN) return dN >= dsN && dN <= deN;
                if(dsN) return dN >= dsN;
                if(deN) return dN <= deN;
                return true;
            }
            return false;
        }

        function getGroupKey(dateStr, grouping) {
            let dN = parseDateToInt(dateStr);
            if (dN > 99999999) dN = Math.floor(dN / 1000000); // Remove 6-digit time if present
            const y = Math.floor(dN / 10000);
            const m = String(Math.floor((dN % 10000) / 100)).padStart(2, '0');
            const d = String(dN % 100).padStart(2, '0');
            
            if (grouping === 'month') {
                return `${y}-${m}`;
            } else if (grouping === 'week') {
                // Approximate week grouping using raw day
                return `${y}-${m}-${d} (Semana)`;
            } else {
                return `${y}-${m}-${d}`;
            }
        }

        window.renderDashboard = function renderDashboard() {
            let vTotal = 0, gTotal = 0;
            const factFiltradas = DB.Ventas_Facturas.filter(f => !ventaEsAnulada(f) && isDateInPeriod(f.Fecha, dashFilter));
            
            let grouping = 'day';
            if (dashFilter === 'custom') {
                const ds = document.getElementById('dash-date-start').value;
                const de = document.getElementById('dash-date-end').value;
                if (ds && de) {
                    const diffDays = Math.ceil(Math.abs(new Date(de) - new Date(ds)) / (1000 * 60 * 60 * 24)); 
                    if (diffDays > 90) grouping = 'month';
                    else if (diffDays > 31) grouping = 'week';
                }
            } else if (dashFilter === 'mes') {
                grouping = 'week';
            }
            
            const groupData = {};
            let rentCosto = 0;

            factFiltradas.forEach(f => {
                const tot = Number(f.Total_Pagar||0);
                vTotal += tot;
                
                const costoVenta = costoDeVenta(DB, f);
                rentCosto += costoVenta;
                
                const k = getGroupKey(f.Fecha, grouping);
                if(!groupData[k]) groupData[k] = { ventas: 0, costo: 0, ganancia: 0 };
                groupData[k].ventas += tot;
                groupData[k].costo += costoVenta;
                groupData[k].ganancia += (tot - costoVenta);
            });

            DB.Gastos.filter(g => isDateInPeriod(g.Fecha, dashFilter)).forEach(g => gTotal += Number(g.Monto||0));
            
            // Mercancia historica que nunca dejo un Gasto registrado.
            // costoMercanciaSinRegistrar descuenta lo que ya esta en Gastos, para no contarlo dos veces.
            let legacyCost = 0;
            (DB.Productos || []).forEach(p => {
                if (isDateInPeriod(p.Creado_En, dashFilter)) legacyCost += costoMercanciaSinRegistrar(DB, p);
            });
            gTotal += legacyCost;

            const egresosTotales = gTotal;
            const util = vTotal - egresosTotales;

            document.getElementById('kpi-ventas').innerText = fMoney(vTotal); document.getElementById('kpi-ventas').title = fMoney(vTotal);
            document.getElementById('kpi-gastos').innerText = fMoney(egresosTotales);
            document.getElementById('kpi-utilidad').innerText = fMoney(util);

            const rentGanancia = vTotal - rentCosto;
            
            if(document.getElementById('kpi-rent-ingreso')) {
                document.getElementById('kpi-rent-ingreso').innerText = fMoney(vTotal); document.getElementById('kpi-rent-ingreso').title = fMoney(vTotal);
                document.getElementById('kpi-rent-costo').innerText = fMoney(rentCosto); document.getElementById('kpi-rent-costo').title = fMoney(rentCosto);
                document.getElementById('kpi-rent-ganancia').innerText = fMoney(rentGanancia); document.getElementById('kpi-rent-ganancia').title = fMoney(rentGanancia);
                
                const noAnuladas = DB.Ventas_Facturas.filter(f => !ventaEsAnulada(f));
                document.getElementById('cnt-ventas-hoy').innerText = noAnuladas.filter(f => isDateInPeriod(f.Fecha, 'hoy')).length;
                document.getElementById('cnt-ventas-semana').innerText = noAnuladas.filter(f => isDateInPeriod(f.Fecha, 'semana')).length;
                document.getElementById('cnt-ventas-mes').innerText = noAnuladas.filter(f => isDateInPeriod(f.Fecha, 'mes')).length;
            }
            
            // Fill Detailed Report Table
            const tbody = document.getElementById('dash-report-tbody');
            if (tbody) {
                let htmlTbody = '';
                Object.keys(groupData).sort().forEach(k => {
                    const row = groupData[k];
                    htmlTbody += `<tr>
                        <td class="p-3 font-medium text-gray-700">${k}</td>
                        <td class="p-3 text-right text-blue-600">${fMoney(row.ventas)}</td>
                        <td class="p-3 text-right text-red-500">${fMoney(row.costo)}</td>
                        <td class="p-3 text-right font-bold text-green-600">${fMoney(row.ganancia)}</td>
                    </tr>`;
                });
                if(htmlTbody === '') htmlTbody = `<tr><td colspan="4" class="p-3 text-center text-gray-500">No hay datos en este periodo</td></tr>`;
                tbody.innerHTML = htmlTbody;
                
                document.getElementById('dash-report-container').classList.remove('hidden-view');
            }

            // Alertas
            const cList = document.getElementById('dash-critico'); cList.innerHTML = '';
            (DB.Productos || []).filter(p => Number(p.Existencias) <= Number(p.Alerta_Minimo)).forEach(p => cList.innerHTML += `<p>• ${p.Nombre} (Quedan: <b>${p.Existencias}</b>)</p>`);
            if(!cList.innerHTML) cList.innerHTML = '<p class="text-green-600 font-bold">No hay productos en alerta de inventario.</p>';

            // Top 5 Rotación
            let rotacion = {};
            factFiltradas.forEach(f => {
                try { JSON.parse(f.Items_JSON||'[]').forEach(i => rotacion[i.id] = (rotacion[i.id]||0) + Number(i.cantidad)); }catch(e){}
            });
            const top5 = Object.keys(rotacion).sort((a,b)=>rotacion[b]-rotacion[a]).slice(0,5);
            const dTop = document.getElementById('dash-top5'); dTop.innerHTML = '';
            top5.forEach(id => {
                const pr = DB.Productos.find(p=>p.ID_Producto===id) || DB.Paquetes.find(p=>p.ID_Paquete===id);
                if(pr) dTop.innerHTML += `<div class="flex justify-between items-center text-sm border-b pb-2"><span>${pr.Nombre || pr.Nombre_Paquete}</span><span class="font-black text-primary bg-gray-100 px-2 py-0.5 rounded">${Number(rotacion[id]||0).toFixed(2).replace(/\.00$/, '')} unds</span></div>`;
            });
            if(!top5.length) dTop.innerHTML = '<p class="text-sm text-gray-400">Sin datos.</p>';

            // Estancado (Productos con 0 ventas en periodo)
            const eList = document.getElementById('dash-estancado'); eList.innerHTML = '';
            (DB.Productos || []).filter(p => !rotacion[p.ID_Producto]).slice(0,10).forEach(p => eList.innerHTML += `<p>• ${p.Nombre}</p>`);

            renderMainChart();
        }
        
        window.descargarReporteDashboard = async () => {
            const tbody = document.getElementById('dash-report-tbody');
            if (!tbody || tbody.innerText.includes('No hay datos')) {
                return showToast('No hay datos para exportar', 'error');
            }
            
            let csvContent = "data:text/csv;charset=utf-8,Periodo,Ventas Totales,Costo Mercancia,Ganancia Bruta\n";
            
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                const cols = row.querySelectorAll('td');
                if(cols.length === 4) {
                    const r = Array.from(cols).map(c => '"' + c.innerText.replace(/["Q,]/g, '').trim() + '"').join(',');
                    csvContent += r + "\n";
                }
            });
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Reporte_Ventas_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast("Reporte CSV Exportado", "success");
        };


        function renderMainChart() {
            const ctx = document.getElementById('mainChart').getContext('2d');
            if(mainChartInstance) mainChartInstance.destroy();

            const cy = new Date().getFullYear();
            const today = new Date();
            
            function getUSWeekInfo(d) {
                let tempD = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
                let startOfYear = new Date(Date.UTC(tempD.getUTCFullYear(), 0, 1));
                let pastDaysOfYear = (tempD - startOfYear) / 86400000;
                let startDay = startOfYear.getUTCDay();
                let weekNo = Math.ceil((pastDaysOfYear + startDay + 1) / 7);
                return { year: tempD.getUTCFullYear(), week: weekNo, dayOfWeek: d.getDay() };
            }

            let labels = [];
            let axisLength = 0;
            
            if (dashFilter === 'hoy') {
                labels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
                axisLength = 7;
            } else if (dashFilter === 'semana') {
                labels = Array.from({length: 53}, (_, i) => `S${i+1}`);
                axisLength = 53;
            } else { 
                labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
                axisLength = 12;
            }

            let dataByYear = {};

            function addFinancialData(dateStr, type, amount) {
                if (!dateStr) return;
                let dN = parseDateToInt(dateStr);
                if (!dN) return;
                if (dN > 99999999) dN = Math.floor(dN / 1000000);
                const py = Math.floor(dN / 10000);
                const pm = Math.floor((dN % 10000) / 100) - 1;
                const pd = dN % 100;
                const d = new Date(py, pm, pd, 12, 0, 0);
                const y = d.getFullYear();
                if (!dataByYear[y]) dataByYear[y] = Array(axisLength).fill(0);
                
                let idx = -1;
                if (dashFilter === 'hoy') {
                    const currentWeekInfo = getUSWeekInfo(today);
                    const dInfo = getUSWeekInfo(d);
                    if (dInfo.week === currentWeekInfo.week && dInfo.year === currentWeekInfo.year) {
                        idx = dInfo.dayOfWeek; 
                    }
                } else if (dashFilter === 'semana') {
                    const info = getUSWeekInfo(d);
                    idx = info.week - 1;
                    if(idx < 0) idx = 0;
                    if(idx >= 53) idx = 52;
                } else {
                    idx = d.getMonth();
                }
                
                if (idx !== -1) {
                    if(type === 'ingreso') dataByYear[y][idx] += amount;
                    else if (type === 'gasto') dataByYear[y][idx] -= amount;
                }
            }

            if (chartIncludeIngresos) {
                (DB.Ventas_Facturas || []).forEach(f => {
                    if (ventaEsAnulada(f)) return;
                    addFinancialData(f.Fecha, 'ingreso', Number(f.Total_Pagar||0));
                });
            }

            if (chartIncludeGastos) {
                (DB.Gastos || []).forEach(g => {
                    addFinancialData(g.Fecha, 'gasto', Number(g.Monto||0));
                });

                (DB.Productos || []).forEach(p => {
                    if(!p.Creado_En) return;
                    const pendiente = costoMercanciaSinRegistrar(DB, p);
                    if (pendiente > 0) addFinancialData(p.Creado_En, 'gasto', pendiente);
                });
            }

            const currentYearData = dataByYear[cy] || Array(axisLength).fill(0);
            const bgColors = currentYearData.map(v => v >= 0 ? '#00D1FF' : '#ea580c'); 

            let datasets = [
                { label: `Balance ${cy}`, type: 'bar', data: currentYearData, backgroundColor: bgColors, borderRadius: 4, order: 2 }
            ];

            const pastYears = Object.keys(dataByYear).filter(y => Number(y) < cy).sort((a,b) => b - a);
            
            pastYears.forEach((y, i) => {
                const alpha = Math.max(0.2, 0.9 - (i * 0.2));
                const color = `rgba(0, 0, 0, ${alpha})`;
                datasets.push({
                    label: `Balance ${y}`, type: 'line', data: dataByYear[y],
                    borderColor: color, 
                    backgroundColor: color,
                    pointBackgroundColor: color,
                    pointBorderColor: color,
                    pointRadius: 4,
                    borderWidth: 2,
                    tension: 0.3,
                    order: 1
                });
            });

            mainChartInstance = new Chart(ctx, {
                type: 'bar',
                data: { labels: labels, datasets: datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { 
                        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) { label += ': '; }
                                    if (context.parsed.y !== null) {
                                        label += 'Q ' + context.parsed.y.toLocaleString();
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, grid: { borderDash: [4, 4] }, ticks: { callback: (val) => 'Q ' + val } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        // --- INVENTARIO & PRECIOS (Actualización Local Rápida) ---
        const openNewProdModal = window.openNewProdModal = () => {
            if(!checkUserActive()) return;
            document.getElementById('prd-id').value = '';
            document.getElementById('prd-nombre').value = '';
            document.getElementById('prd-marca').value = '';
            document.getElementById('prd-cat').value = '';
            document.getElementById('prd-desc').value = '';
            document.getElementById('prd-costo').value = '';

            document.getElementById('prd-stock').value = '0';
            document.getElementById('prd-alerta').value = '5';
            document.getElementById('prd-caducidad').value = '';
            document.getElementById('prd-precio').value = '';

            // Fraccionamiento: siempre arranca apagado en un producto nuevo
            document.getElementById('prd-frac-chk').checked = false;
            document.getElementById('frac-fields').classList.add('hidden');
            document.getElementById('prd-frac-tipo').value = 'Blíster';
            document.getElementById('prd-frac-cant').value = '';
            document.getElementById('prd-frac-precio').value = '';

            // Caja: inicializar como unchecked y ocultar
            document.getElementById('prd-fue-caja').checked = false;
            document.getElementById('prd-caja-section').classList.add('hidden');

            document.getElementById('mod-prod-title').innerText = "Nuevo Producto";
            calcMargen();
            openModal('mod-producto');
        };

        const calcMargen = window.calcMargen = () => {
            const c = Number(document.getElementById('prd-costo').value || 0);
            const p = Number(document.getElementById('prd-precio').value || 0);
            let m = 0;
            if (p > 0) {
                m = (1 - (c / p)) * 100;
            }
            if(document.getElementById('prd-margen-calc')) document.getElementById('prd-margen-calc').innerText = m.toFixed(2) + '%';
            
            const fracCantEl = document.getElementById('prd-frac-cant');
            const fracPrecioEl = document.getElementById('prd-frac-precio');
            if (fracCantEl && fracPrecioEl && document.activeElement !== fracPrecioEl) {
                const fc = Number(fracCantEl.value || 0);
                if (fc > 0 && p > 0) {
                    fracPrecioEl.value = (p / fc).toFixed(2);
                }
            }
        };

        const openRestockModal = window.openRestockModal = (id) => {
            if(!checkUserActive()) return;
            const p = DB.Productos.find(x => x.ID_Producto === id);
            document.getElementById('rst-id').value = p.ID_Producto;
            document.getElementById('rst-nombre').value = p.Nombre + (p.Marca ? ' (' + p.Marca + ')' : '');
            document.getElementById('rst-costo').value = p.Costo_Compra;
            document.getElementById('rst-cantidad').value = '';
            document.getElementById('rst-notas').value = '';
            document.getElementById('rst-fue-caja').checked = false; // Por defecto: NO es dinero de caja
            openModal('mod-abastecer');
        };

        const saveRestock = window.saveRestock = async () => {
            if(!checkUserActive()) return;
            const id = document.getElementById('rst-id').value;
            const cant = Number(document.getElementById('rst-cantidad').value);
            const costo = Number(document.getElementById('rst-costo').value);
            const notas = document.getElementById('rst-notas').value;

            if(cant <= 0 || costo < 0) return showToast("Cantidades inválidas", "error");

            const p = DB.Productos.find(x => x.ID_Producto === id);
            
            // HALLAZGO 9: Usar generador de ID único
            const rstData = {
                ID_Compra: generarIdUnico('CMP-'),
                ID_Producto: id,
                Producto_Nombre: p.Nombre,
                Cantidad: cant,
                Costo_Unitario: costo,
                Proveedor: notas,
                Fecha: sysTime(),
                Usuario: getActiveUserName()
            };

            p.Existencias = Number(p.Existencias) + cant;
            p.Costo_Compra = costo;
            p.Creado_En = sysTime();
            p.Precio_Venta = costo / (1 - (Number(p.Margen_Ganancia)/100));

            setLoading(true);
            
            if(!DB.Inventario_Compras) DB.Inventario_Compras = [];
            DB.Inventario_Compras.push(rstData);

            // El reabastecimiento es dinero que sale: queda como Gasto de mercancia.
            // El formato "[ID: xxx] (N unds)" es el que lee costoMercanciaSinRegistrar
            // para no contar dos veces el mismo inventario.
            // HALLAZGO 9: Usar generador de ID único
            const gastoCompra = {
                ID_Gasto: generarIdUnico('GST-'),
                Fecha: sysTime(),
                Tipo: 'Mercancía',
                Concepto: `Ingreso de inventario: ${p.Nombre} [ID: ${p.ID_Producto}] (${cant} unds)`,
                Monto: Number((cant * costo).toFixed(2)),
                Usuario: getActiveUserName(),
                Fue_De_Caja: document.getElementById('rst-fue-caja').checked ? 'SI' : 'NO'
            };
            if (!DB.Gastos) DB.Gastos = [];
            DB.Gastos.push(gastoCompra);

            // HALLAZGO 4: Crear llamada a processRestock en el backend
            const restockPayload = {
                compraData: rstData,
                gastoData: gastoCompra,
                productoActualizado: p
            };

            await apiCall('crud', { sheetName: 'Inventario_Compras', operation: 'create', rowData: rstData, idField: 'ID_Compra', idValue: rstData.ID_Compra });
            apiCall('crud', { sheetName: 'Gastos', operation: 'create', rowData: gastoCompra, idField: 'ID_Gasto', idValue: gastoCompra.ID_Gasto });
            // Enviar a backend para procesamiento adicional (validaciones, auditoría)
            apiCall('processRestock', restockPayload);
            logAudit('Inventario', 'Reabastecer', `Compra: ${rstData.Producto_Nombre} (+${rstData.Cantidad}) por ${fMoney(gastoCompra.Monto)}`);
            await apiCall('crud', { sheetName: 'Productos', operation: 'update', rowData: p, idField: 'ID_Producto', idValue: p.ID_Producto });

            setLoading(false);

            renderProductos();
            renderCompras();
            renderPosCatalog();
            renderFinanzas();
            renderDashboard();
            closeModal('mod-abastecer');
            showToast("Stock abastecido y gasto registrado");
        };

        const saveProducto = window.saveProducto = async () => {
            if(!checkUserActive()) return;
            const isNew = !document.getElementById('prd-id').value;
            // HALLAZGO 9: Usar generador de ID único
            const id = document.getElementById('prd-id').value || generarIdUnico('PRD-');
            const c = Number(document.getElementById('prd-costo').value||0);
            const p = Number(document.getElementById('prd-precio').value||0);
            
            if (p < c) {
                if(!confirm(`¡Atención! El precio de venta (Q${p}) es MENOR que el costo (Q${c}). ¿Está seguro que desea guardar este producto y vender con pérdidas?`)) {
                    return;
                }
            }
            
            let m = 0;
            if (p > 0) m = (1 - (c / p)) * 100;
            const existenciasNuevas = Number(document.getElementById('prd-stock').value || 0);
            
            const isFraccionada = document.getElementById('prd-frac-chk').checked;

            const data = {
                ID_Producto: id, Nombre: document.getElementById('prd-nombre').value,
                Marca: document.getElementById('prd-marca').value || '',
                ID_Categoria: document.getElementById('prd-cat').value, Descripcion: document.getElementById('prd-desc').value,
                Costo_Compra: c, Margen_Ganancia: m, Precio_Venta: p,
                Existencias: existenciasNuevas,
                Alerta_Minimo: document.getElementById('prd-alerta').value,
                Fecha_Caducidad: document.getElementById('prd-caducidad').value, Creado_En: (!isNew && DB.Productos.find(x => x.ID_Producto === id)) ? DB.Productos.find(x => x.ID_Producto === id).Creado_En : sysTime(),
                Venta_Fraccionada: isFraccionada,
                Fraccion_Tipo: isFraccionada ? document.getElementById('prd-frac-tipo').value : '',
                Fraccion_Cant: isFraccionada ? Number(document.getElementById('prd-frac-cant').value || 0) : 0,
                Fraccion_Precio: isFraccionada ? Number(document.getElementById('prd-frac-precio').value || 0) : 0
            };
            if(!data.Nombre || !data.ID_Categoria || !data.Marca || p <= 0) return showToast("Datos inválidos (Marca requerida y Precio > 0)", "error");

            // Local Update
            let existenciasAgregadas = 0;
            const pIdx = DB.Productos.findIndex(x => x.ID_Producto === id);
            if (pIdx > -1) {
                const stockAnterior = Number(DB.Productos[pIdx].Existencias || 0);
                if (existenciasNuevas > stockAnterior) {
                    existenciasAgregadas = existenciasNuevas - stockAnterior;
                }
                DB.Productos[pIdx] = data; 
            } else {
                existenciasAgregadas = existenciasNuevas;
                DB.Productos.push(data);
            }

            if (existenciasAgregadas > 0) {
                const costoMercancia = existenciasAgregadas * c;
                const gastoData = { ID_Gasto: 'GST-'+Date.now(), Fecha: sysTime(), Tipo: 'Mercancía', Concepto: `Ingreso de inventario: ${data.Nombre} [ID: ${id}] (${existenciasAgregadas} unds)`, Monto: costoMercancia, Usuario: getActiveUserName(), Fue_De_Caja: document.getElementById('prd-fue-caja').checked ? 'SI' : 'NO' };
                DB.Gastos.push(gastoData);
                apiCall('crud', { sheetName: 'Gastos', operation: 'create', rowData: gastoData, idField: 'ID_Gasto', idValue: gastoData.ID_Gasto });
                logAudit('Finanzas', 'Crear Gasto', `Gasto Automático por Compra de Inventario: ${gastoData.Concepto} por Q${gastoData.Monto} [${gastoData.ID_Gasto}] (Caja: ${gastoData.Fue_De_Caja})`);
            }

            renderProductos(); renderPosCatalog();
            showToast("Producto Guardado"); closeModal('mod-producto');

            apiCall('crud', { sheetName: 'Productos', operation: isNew ? 'create' : 'update', rowData: data, idField: 'ID_Producto', idValue: id });
            logAudit('Inventario', isNew ? 'Crear Producto' : 'Editar Producto', `Producto: ${data.Nombre} [${id}]`);
            
            if(existenciasAgregadas > 0) {
                renderFinanzas();
                renderDashboard();
            }
        };

        const saveCategoria = window.saveCategoria = async () => {
            if(!checkUserActive()) return;
            const id = document.getElementById('cat-id').value || 'CAT-'+Date.now();
            const n = document.getElementById('cat-nombre').value;
            if(!n) return;

            const existing = DB.Categorias.find(c => c.Nombre_Categoria.toLowerCase() === n.trim().toLowerCase() && c.ID_Categoria !== id);
            if (existing) {
                return showToast(`La categoría "${n}" ya existe.`, "error");
            }

            const data = { ID_Categoria: id, Nombre_Categoria: n.trim(), Creado_En: sysTime() };
            
            const cIdx = DB.Categorias.findIndex(x => x.ID_Categoria === id);
            if(cIdx > -1) DB.Categorias[cIdx] = data; else DB.Categorias.push(data);
            
            applyConfig(); renderCategorias(); renderPosCategories();
            document.getElementById('cat-nombre').value = ''; document.getElementById('cat-id').value = '';
            showToast("Categoría Guardada"); closeModal('mod-categoria');
            apiCall('crud', { sheetName: 'Categorias', operation: cIdx>-1?'update':'create', rowData: data, idField: 'ID_Categoria', idValue: id });
            logAudit('Inventario', 'Crear/Editar Categoria', `Categoria ID: ${id}`);
        };

        const editCategoria = window.editCategoria = (id) => {
            if(!checkUserActive()) return;
            const c = DB.Categorias.find(x => x.ID_Categoria === id);
            document.getElementById('cat-id').value = id;
            document.getElementById('cat-nombre').value = c.Nombre_Categoria;
            document.getElementById('mod-cat-title').innerText = "Editar Categoría";
            openModal('mod-categoria');
        };

        const deleteCategoria = window.deleteCategoria = async (id) => {
            if(!checkUserActive()) return;
            if(!confirm("¿Eliminar categoría?")) return;
            DB.Categorias = DB.Categorias.filter(x => x.ID_Categoria !== id);
            applyConfig(); renderCategorias(); renderPosCategories(); showToast("Categoría Eliminada");
            apiCall('crud', { sheetName: 'Categorias', operation: 'delete', idField: 'ID_Categoria', idValue: id });
            logAudit('Inventario', 'Eliminar Categoria', `Categoria ID: ${id}`);
        };

        const applyProductFilter = window.applyProductFilter = (q) => {
            if (!q) return DB.Productos || [];
            return (DB.Productos || []).filter(p => {
                const catObj = (DB.Categorias || []).find(c => c.ID_Categoria === p.ID_Categoria);
                const catName = (catObj ? catObj.Nombre_Categoria : '').toLowerCase();
                return (p.Nombre || '').toLowerCase().includes(q) || 
                       (p.Marca || '').toLowerCase().includes(q) || 
                       (p.ID_Producto || '').toLowerCase().includes(q) ||
                       catName.includes(q);
            });
        };

        let sortProductos = { col: 'nombre', asc: true };
        window.toggleSortProductos = (col) => {
            if(sortProductos.col === col) sortProductos.asc = !sortProductos.asc;
            else { sortProductos.col = col; sortProductos.asc = true; }
            renderProductos();
        };

        window.renderProductos = function renderProductos() {
            const q = (document.getElementById('srch-prod').value || '').toLowerCase();
            const tb = document.getElementById('tbl-productos');
            
            let html = '';
            let filtered = applyProductFilter(q);
            
            let stk = 0, cv = 0, vv = 0;
            filtered.forEach(p => {
                const s = Number(p.Existencias || 0);
                const cu = Number(p.Costo_Compra || 0);
                const pu = Number(p.Precio_Venta || 0);
                stk += s; cv += (s * cu); vv += (s * pu);
            });
            const ge = vv - cv;
            const sumEl = document.getElementById('inv-summary');
            if(sumEl) {
                sumEl.innerHTML = `
                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <p class="text-[10px] text-gray-500 uppercase font-bold mb-1">Productos Únicos</p>
                        <p class="text-lg font-black text-gray-700">${filtered.length}</p>
                    </div>
                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <p class="text-[10px] text-gray-500 uppercase font-bold mb-1">Stock Total</p>
                        <p class="text-lg font-black text-primary">${stk.toLocaleString()} unds</p>
                    </div>
                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm admin-only">
                        <p class="text-[10px] text-gray-500 uppercase font-bold mb-1">Costo Total (Inversión)</p>
                        <p class="text-lg font-black text-red-600">${fMoney(cv)}</p>
                    </div>
                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm admin-only">
                        <p class="text-[10px] text-gray-500 uppercase font-bold mb-1">Ingreso Esperado</p>
                        <p class="text-lg font-black text-green-600">${fMoney(vv)}</p>
                    </div>
                    <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm admin-only">
                        <p class="text-[10px] text-gray-500 uppercase font-bold mb-1">Ganancia Esperada</p>
                        <p class="text-lg font-black text-blue-600">${fMoney(ge)}</p>
                    </div>
                `;
            }

            filtered.sort((a,b) => {
                let vA, vB;
                const cTotalA = Number(a.Costo_Compra || 0) * Number(a.Existencias || 0);
                const vTotalA = Number(a.Precio_Venta || 0) * Number(a.Existencias || 0);
                const cTotalB = Number(b.Costo_Compra || 0) * Number(b.Existencias || 0);
                const vTotalB = Number(b.Precio_Venta || 0) * Number(b.Existencias || 0);
                
                if(sortProductos.col === 'nombre') { vA = (a.Nombre||'').toLowerCase(); vB = (b.Nombre||'').toLowerCase(); }
                else if(sortProductos.col === 'marca') { vA = (a.Marca||'').toLowerCase(); vB = (b.Marca||'').toLowerCase(); }
                else if(sortProductos.col === 'categoria') { vA = (a.ID_Categoria||'').toLowerCase(); vB = (b.ID_Categoria||'').toLowerCase(); }
                else if(sortProductos.col === 'costo') { vA = Number(a.Costo_Compra||0); vB = Number(b.Costo_Compra||0); }
                else if(sortProductos.col === 'margen') { vA = Number(a.Margen_Ganancia||0); vB = Number(b.Margen_Ganancia||0); }
                else if(sortProductos.col === 'precio') { vA = Number(a.Precio_Venta||0); vB = Number(b.Precio_Venta||0); }
                else if(sortProductos.col === 'stock') { vA = Number(a.Existencias||0); vB = Number(b.Existencias||0); }
                else if(sortProductos.col === 'ctotal') { vA = cTotalA; vB = cTotalB; }
                else if(sortProductos.col === 'vtotal') { vA = vTotalA; vB = vTotalB; }
                else if(sortProductos.col === 'ganancia') { vA = vTotalA - cTotalA; vB = vTotalB - cTotalB; }
                
                if(vA < vB) return sortProductos.asc ? -1 : 1;
                if(vA > vB) return sortProductos.asc ? 1 : -1;
                return 0;
            });

            if (!window.renderProductos.renderId) window.renderProductos.renderId = 0;
            window.renderProductos.renderId++;
            const currentRenderId = window.renderProductos.renderId;

            tb.innerHTML = '';
            if (filtered.length === 0) {
                tb.innerHTML = `<tr><td colspan="11" class="p-4 text-center text-gray-500 italic">No hay productos que coincidan con la búsqueda.</td></tr>`;
                return;
            }

            let currentIdx = 0;
            const chunkSize = 150; // Procesamos de 150 en 150 para no congelar la pantalla

            const renderChunk = () => {
                if (window.renderProductos.renderId !== currentRenderId) return; // Se cancela si se hizo otra búsqueda rápida
                if (currentIdx >= filtered.length) return;

                const end = Math.min(currentIdx + chunkSize, filtered.length);
                let chunkHtml = '';

                for (let i = currentIdx; i < end; i++) {
                    const p = filtered[i];
                    const isCrit = Number(p.Existencias) <= Number(p.Alerta_Minimo);
                    const catObj = (DB.Categorias || []).find(c => c.ID_Categoria === p.ID_Categoria);
                    const catName = catObj ? catObj.Nombre_Categoria : 'Sin Categoría';
                    const cTotal = Number(p.Costo_Compra || 0) * Number(p.Existencias || 0);
                    const vTotal = Number(p.Precio_Venta || 0) * Number(p.Existencias || 0);
                    const gTotal = vTotal - cTotal;

                    let stockStr = `${Number(p.Existencias || 0).toFixed(2).replace(/\.00$/, '')}`;
                    if (p.Venta_Fraccionada === true || p.Venta_Fraccionada === 'true') {
                        const totQ = Number(p.Existencias || 0);
                        const cjs = Math.floor(totQ);
                        const fC = Number(p.Fraccion_Cant || 1);
                        const fracs = Math.round((totQ - cjs) * fC);
                        const totalPieces = Math.round(totQ * fC);
                        const typeLabel = p.Fraccion_Tipo ? p.Fraccion_Tipo.toLowerCase() + (p.Fraccion_Tipo.toLowerCase().endsWith('s') ? '' : 's') : 'fracciones';
                        
                        if (fracs > 0) {
                            stockStr = `<span class="text-base">${cjs}</span> <span class="text-[10px] text-gray-500">cajas</span><br><span class="text-xs text-blue-600">${fracs}/${fC} abiertas</span><br><span class="text-[11px] text-gray-600 block mt-1 font-bold">Total: ${totalPieces} ${typeLabel}</span>`;
                        } else {
                            stockStr = `<span class="text-base">${cjs}</span> <span class="text-[10px] text-gray-500">cajas</span><br><span class="text-[11px] text-gray-600 block mt-1 font-bold">Total: ${totalPieces} ${typeLabel}</span>`;
                        }
                    }

                    chunkHtml += `<tr class="hover:bg-gray-50">
                        <td class="p-4"><p class="font-bold text-primary">${p.Nombre}</p><span class="text-[10px] font-mono text-gray-400">${p.ID_Producto}</span></td>
                        <td class="p-4 font-bold text-blue-600 text-xs">${p.Marca || '-'}</td>
                        <td class="p-4"><span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded font-bold">${catName}</span></td>
                        <td class="p-4 text-gray-600 admin-only">${fMoney(p.Costo_Compra)}</td><td class="p-4 text-gray-600 admin-only">${Number(p.Margen_Ganancia||0).toFixed(2)}%</td>
                        <td class="p-4 font-black text-primary">
                            ${fMoney(p.Precio_Venta)}
                            ${(p.Venta_Fraccionada === true || p.Venta_Fraccionada === 'true') ? `<br><span class="text-[10px] text-blue-600 font-bold bg-blue-50 px-1 rounded" title="Precio Unitario (${p.Fraccion_Tipo})">${fMoney(p.Fraccion_Precio)}</span>` : ''}
                        </td>
                        <td class="p-4 font-bold ${isCrit?'text-red-500':'text-accent'}">${stockStr}</td>
                        <td class="p-4 text-gray-600 admin-only">${fMoney(cTotal)}</td>
                        <td class="p-4 text-gray-600 admin-only">${fMoney(vTotal)}</td>
                        <td class="p-4 font-bold text-accent admin-only">${fMoney(gTotal)}</td>
                        <td class="p-4 flex gap-2">
                            <button onclick="editProd('${p.ID_Producto}')" class="text-blue-500 hover:text-blue-700 transition" title="Editar"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="openRestockModal('${p.ID_Producto}')" class="text-accent hover:text-darkaccent transition" title="Abastecer Stock"><i class="fa-solid fa-box-open"></i></button>
                            <button onclick="deleteProd('${p.ID_Producto}')" class="text-red-500 hover:text-red-700 transition" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>`;
                }
                
                tb.insertAdjacentHTML('beforeend', chunkHtml);
                currentIdx += chunkSize;
                
                if (currentIdx < filtered.length) {
                    setTimeout(renderChunk, 5); // Le da tiempo al navegador a respirar y ocultar el loader
                }
            };

            renderChunk();
        }

        window.renderInventario = function renderInventario() {
            renderProductos();
            renderCategorias();
            renderCompras();
        };

        function renderCompras() {
            const tb = document.getElementById('tbl-compras');
            if(!tb) return;
            let html = '';
            const cFiltered = (DB.Inventario_Compras || []).slice().reverse();
            cFiltered.forEach(c => {
                html += `<tr class="hover:bg-gray-50 border-b border-gray-100">
                    <td class="p-3 text-xs text-gray-500 font-mono">${formatDisplayDate(c.Fecha)}</td>
                    <td class="p-3 text-sm font-bold text-primary">${c.Producto_Nombre}</td>
                    <td class="p-3 text-sm"><span class="bg-gray-100 px-2 py-1 rounded font-mono">${c.ID_Producto}</span></td>
                    <td class="p-3 text-sm font-bold text-accent">+${c.Cantidad}</td>
                    <td class="p-3 text-sm text-gray-600">${fMoney(c.Costo_Unitario)}</td>
                    <td class="p-3 text-sm text-gray-600">${fMoney(Number(c.Cantidad)*Number(c.Costo_Unitario))}</td>
                    <td class="p-3 text-xs text-gray-500">${c.Proveedor||'-'}</td>
                    <td class="p-3 text-xs text-gray-500 uppercase">${c.Usuario||'-'}</td>
                </tr>`;
            });
            tb.innerHTML = html;
        }

        const deleteProd = window.deleteProd = async (id) => {
            if(!checkUserActive()) return;
            const p = DB.Productos.find(x => x.ID_Producto === id);
            if(!p) return;
            if(!confirm(`¿Estás seguro de que deseas eliminar permanentemente el producto "${p.Nombre}"?\nEsta acción no se puede deshacer y el producto desaparecerá del inventario.`)) return;
            
            DB.Productos = DB.Productos.filter(x => x.ID_Producto !== id);
            renderProductos();
            showToast("Producto Eliminado permanentemente", "success");
            
            apiCall('crud', { sheetName: 'Productos', operation: 'delete', idField: 'ID_Producto', idValue: id });
            logAudit('Inventario', 'Eliminar Producto', `Producto Eliminado: ${p.Nombre} (ID: ${id})`);
        };

        const editProd = window.editProd = (id) => {
            if(!checkUserActive()) return;
            const p = DB.Productos.find(x=>x.ID_Producto===id);
            document.getElementById('prd-id').value = id;
            document.getElementById('prd-nombre').value = p.Nombre;
            const marcaEl = document.getElementById('prd-marca'); if (marcaEl) marcaEl.value = p.Marca || '';
            document.getElementById('prd-cat').value = p.ID_Categoria;
            document.getElementById('prd-desc').value = p.Descripcion || '';
            document.getElementById('prd-costo').value = p.Costo_Compra;

            document.getElementById('prd-stock').value = p.Existencias;
            document.getElementById('prd-alerta').value = p.Alerta_Minimo;
            document.getElementById('prd-caducidad').value = p.Fecha_Caducidad || '';
            document.getElementById('prd-precio').value = p.Precio_Venta || 0;
            
            // Fraccionamiento
            const isFrac = p.Venta_Fraccionada === true || String(p.Venta_Fraccionada).toLowerCase() === 'true';
            document.getElementById('prd-frac-chk').checked = isFrac;
            document.getElementById('frac-fields').classList.toggle('hidden', !isFrac);
            if(isFrac) {
                document.getElementById('prd-frac-tipo').value = p.Fraccion_Tipo || '';
                document.getElementById('prd-frac-cant').value = p.Fraccion_Cant || '';
                document.getElementById('prd-frac-precio').value = p.Fraccion_Precio || '';
            } else {
                document.getElementById('prd-frac-tipo').value = 'Blíster';
                document.getElementById('prd-frac-cant').value = '';
                document.getElementById('prd-frac-precio').value = '';
            }

            document.getElementById('mod-prod-title').innerText = "Editar Producto";
            calcMargen(); openModal('mod-producto');
        };



        function renderCategorias() {
            const lst = document.getElementById('lst-categorias'); lst.innerHTML = '';
            (DB.Categorias || []).forEach(c => lst.innerHTML += `<div class="flex justify-between items-center bg-gray-50 p-3 rounded border border-gray-200"><span class="font-bold text-primary">${c.Nombre_Categoria}</span><div class="flex gap-2 text-sm"><button onclick="editCategoria('${c.ID_Categoria}')" class="text-blue-500 hover:text-blue-700"><i class="fa-solid fa-pen"></i></button><button onclick="deleteCategoria('${c.ID_Categoria}')" class="text-red-500 hover:text-red-700"><i class="fa-solid fa-trash"></i></button></div></div>`);
        }

        // --- PAQUETES (En Ajustes) ---
        let pkgTempItems = [];
        
        const openNewPkgModal = window.openNewPkgModal = () => {
            if(!checkUserActive()) return;
            document.getElementById('pkg-id').value = '';
            document.getElementById('pkg-nombre').value = '';
            document.getElementById('pkg-descuento').value = '0';
            pkgTempItems = [];
            renderPkgList();
            openModal('mod-paquete');
        };

        const addPkgItem = window.addPkgItem = () => {
            if(!checkUserActive()) return;
            const sel = document.getElementById('pkg-sel-prod');
            const q = document.getElementById('pkg-sel-qty').value;
            if(!sel.value || q<1) return;
            const p = DB.Productos.find(x=>x.ID_Producto===sel.value);
            pkgTempItems.push({ id: p.ID_Producto, name: p.Nombre, cantidad: Number(q), precio: Number(p.Precio_Venta) });
            renderPkgList();
        };

        const renderPkgList = () => {
            const u = document.getElementById('pkg-items-list'); u.innerHTML = '';
            let total = 0;
            pkgTempItems.forEach((i, idx) => {
                const subtotal = i.cantidad * i.precio;
                total += subtotal;
                u.innerHTML += `<li class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-100">
                    <div class="flex flex-col">
                        <span><b class="text-primary">${i.cantidad}x</b> ${i.name}</span>
                        <span class="text-[10px] text-gray-500">${fMoney(i.precio)} c/u</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="font-bold text-primary">${fMoney(subtotal)}</span>
                        <button type="button" onclick="pkgTempItems.splice(${idx},1); renderPkgList()" class="text-red-500 hover:text-red-700 transition"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </li>`;
            });
            document.getElementById('pkg-total-original').innerText = fMoney(total);
            calcPkgFinalPrice(total);
        };

        const calcPkgFinalPrice = window.calcPkgFinalPrice = (totalOverride) => {
            let total = typeof totalOverride === 'number' ? totalOverride : pkgTempItems.reduce((s, i) => s + (i.cantidad * i.precio), 0);
            const desc = Number(document.getElementById('pkg-descuento').value || 0);
            const finalPrice = total - (total * (desc / 100));
            document.getElementById('pkg-precio-final').innerText = fMoney(finalPrice);
            document.getElementById('pkg-precio-final').dataset.value = finalPrice;
        };

        const savePaquete = window.savePaquete = async () => {
            if(!checkUserActive()) return;
            // HALLAZGO 9: Usar generador de ID único
            const id = document.getElementById('pkg-id').value || generarIdUnico('PKG-');
            const finalPrice = Number(document.getElementById('pkg-precio-final').dataset.value || 0);
            
            const data = { ID_Paquete: id, Nombre_Paquete: document.getElementById('pkg-nombre').value, Productos_JSON: JSON.stringify(pkgTempItems), Precio_Combo: finalPrice, Estado: 'Activo', Creado_En: sysTime() };
            if(!data.Nombre_Paquete || !pkgTempItems.length || finalPrice <= 0) return showToast("Datos incompletos o precio inválido", "error");
            
            // Local Update
            const pIdx = DB.Paquetes.findIndex(x => x.ID_Paquete === id);
            if (pIdx > -1) DB.Paquetes[pIdx] = data; else DB.Paquetes.push(data);
            renderPaquetes(); renderPosCatalog();
            showToast("Paquete guardado"); closeModal('mod-paquete');

            apiCall('crud', { sheetName: 'Paquetes', operation: document.getElementById('pkg-id').value?'update':'create', rowData: data, idField: 'ID_Paquete', idValue: id });
            logAudit('Inventario', 'Crear/Editar Paquete', `Paquete: ${data.Nombre_Paquete} [${id}]`);
        };
        function renderPaquetes() {
            const l = document.getElementById('lst-paquetes'); l.innerHTML = '';
            (DB.Paquetes || []).forEach(p => {
                let its = [];
                try { its = JSON.parse(p.Productos_JSON||'[]'); } catch(e){}
                l.innerHTML += `<div class="bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm relative group">
                    <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="editPaquete('${p.ID_Paquete}')" class="text-blue-500 hover:text-blue-700 bg-white shadow p-1.5 rounded" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deletePaquete('${p.ID_Paquete}')" class="text-red-500 hover:text-red-700 bg-white shadow p-1.5 rounded" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    <h4 class="font-bold text-primary pr-16">${p.Nombre_Paquete}</h4>
                    <p class="text-2xl font-black text-primary mt-1">${fMoney(p.Precio_Combo)}</p>
                    <ul class="text-xs text-gray-500 mt-2 space-y-1">${its.map(i=>`<li>- <b>${i.cantidad}x</b> ${i.name}</li>`).join('')}</ul>
                </div>`;
            });
            if(!DB.Paquetes || !DB.Paquetes.length) l.innerHTML = '<p class="text-sm text-gray-400">No hay paquetes creados.</p>';
        }

        window.editPaquete = (id) => {
            if(!checkUserActive()) return;
            const p = DB.Paquetes.find(x => x.ID_Paquete === id);
            if(!p) return;
            
            document.getElementById('pkg-id').value = p.ID_Paquete;
            document.getElementById('pkg-nombre').value = p.Nombre_Paquete;
            
            let items = [];
            try { items = JSON.parse(p.Productos_JSON || '[]'); } catch(e){}
            pkgTempItems = items;
            renderPkgList();
            
            const totalOriginal = pkgTempItems.reduce((acc, i) => acc + (i.cantidad * i.precio), 0);
            const finalPrice = p.Precio_Combo;
            let desc = 0;
            if (totalOriginal > 0) desc = ((totalOriginal - finalPrice) / totalOriginal) * 100;
            document.getElementById('pkg-descuento').value = desc.toFixed(1);
            
            openModal('mod-paquete');
            calcPkgFinalPrice(totalOriginal);
        };

        window.deletePaquete = async (id) => {
            if(!checkUserActive()) return;
            const p = DB.Paquetes.find(x => x.ID_Paquete === id);
            if(!p) return;
            if(!confirm(`¿Estás seguro de que deseas eliminar permanentemente el paquete "${p.Nombre_Paquete}"?`)) return;
            
            DB.Paquetes = DB.Paquetes.filter(x => x.ID_Paquete !== id);
            renderPaquetes();
            renderPosCatalog();
            showToast("Paquete Eliminado permanentemente", "success");
            
            apiCall('crud', { sheetName: 'Paquetes', operation: 'delete', idField: 'ID_Paquete', idValue: id });
            logAudit('Inventario', 'Eliminar Paquete', `Paquete: ${p.Nombre_Paquete} [${id}]`);
        };

        // --- CAJA POS (Actualización Local Inmediata) ---
        const setPosCategory = window.setPosCategory = (id) => {
            activePosCategory = id;
            document.getElementById('pos-search').value = ''; 
            updatePosMidHeader();
            renderPosCategories();
            renderPosCatalog();
        };

        window.updatePosMidHeader = function updatePosMidHeader() {
            const header = document.getElementById('pos-mid-title');
            const btn = document.getElementById('pos-mid-btn');
            if(activePosCategory === 'PAQUETES') {
                header.innerHTML = '<i class="fa-solid fa-boxes-packing mr-2"></i> Paquetes y Combos';
                btn.classList.remove('hidden-view');
            } else if (activePosCategory) {
                const cat = DB.Categorias.find(c => c.ID_Categoria === activePosCategory);
                header.innerHTML = `<i class="fa-solid fa-folder-open mr-2 text-gray-400"></i> ${cat ? cat.Nombre_Categoria : 'Categoría'}`;
                btn.classList.add('hidden-view');
            } else {
                header.innerHTML = '<i class="fa-solid fa-search mr-2 text-gray-400"></i> Búsqueda Global';
                btn.classList.add('hidden-view');
            }
        }

        window.renderPosCategories = function renderPosCategories() {
            const cont = document.getElementById('pos-menu-cats');
            if(!cont) return;
            
            let html = `<div onclick="setPosCategory('PAQUETES')" class="p-3 mb-2 rounded-lg cursor-pointer transition flex items-center ${activePosCategory === 'PAQUETES' ? 'bg-primary text-accent font-bold shadow-md' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-600'}">
                <i class="fa-solid fa-boxes-packing mr-3 ${activePosCategory === 'PAQUETES' ? 'text-accent' : 'text-gray-400'}"></i> Paquetes
            </div>`;
            
            (DB.Categorias || []).forEach(c => {
                const isActive = activePosCategory === c.ID_Categoria;
                html += `<div onclick="setPosCategory('${c.ID_Categoria}')" class="p-3 mb-2 rounded-lg cursor-pointer transition flex items-center ${isActive ? 'bg-primary text-accent font-bold shadow-md' : 'bg-white hover:bg-gray-50 border border-gray-200 text-gray-600'}">
                    <i class="fa-solid fa-folder mr-3 ${isActive ? 'text-accent' : 'text-gray-400'}"></i> ${c.Nombre_Categoria}
                </div>`;
            });
            cont.innerHTML = html;
        }

        // Tarjeta de producto del POS (misma pieza para busqueda y categorias)
        const posProductoCardHTML = (p) => {
            const stock = Number(p.Existencias);
            const esFraccionado = !!(p.Venta_Fraccionada && p.Fraccion_Cant);
            const rojo = stock < 1 ? 'text-red-500' : 'text-gray-400';

            let stockDisplay = `<span class="text-xs ${rojo} font-bold">Stock: ${stock.toFixed(2).replace(/\.00$/, '')}</span>`;
            if (esFraccionado) {
                const cjs = Math.floor(stock);
                const fC = Number(p.Fraccion_Cant);
                const fracs = Math.round((stock - cjs) * fC);
                const totalPieces = Math.round(stock * fC);
                const typeLabel = p.Fraccion_Tipo ? p.Fraccion_Tipo.toLowerCase() + (p.Fraccion_Tipo.toLowerCase().endsWith('s') ? '' : 's') : 'fracciones';
                const abiertas = fracs > 0 ? `<span class="text-[10px] text-blue-600">${fracs}/${fC} abiertas</span><br>` : '';
                stockDisplay = `<span class="text-xs ${rojo} font-bold leading-tight">Stock: ${cjs} cajas<br>${abiertas}<span class="text-[10px] text-gray-500 block mt-0.5">Total: ${totalPieces} ${typeLabel}</span></span>`;
            }

            const precio = `<span class="font-black text-primary">${fMoney(p.Precio_Venta)}</span>`;
            let actionHtml = `<div class="mt-3 flex justify-between items-end">${stockDisplay}${precio}</div>`;

            if (esFraccionado) {
                actionHtml = `<div class="mt-3 flex justify-between items-end mb-2">${stockDisplay}${precio}</div>
                    <div class="mt-1 flex gap-1">
                        <button ${stock>=1?`onclick="event.stopPropagation(); addToCart('${p.ID_Producto}', false, ${p.Precio_Venta}, '${p.Nombre}', ${p.Costo_Compra}, false)"`:'disabled'} class="flex-1 bg-gray-100 ${stock>=1?'hover:bg-gray-200 text-primary':'text-gray-400 opacity-50 cursor-not-allowed'} py-1 rounded text-xs font-bold transition border border-gray-300">Caja</button>
                        <button ${stock>0?`onclick="event.stopPropagation(); addToCart('${p.ID_Producto}', false, ${p.Fraccion_Precio}, '${p.Nombre} (${p.Fraccion_Tipo})', ${p.Costo_Compra / p.Fraccion_Cant}, true)"`:'disabled'} class="flex-1 bg-blue-100 ${stock>0?'hover:bg-blue-200 text-blue-700':'text-gray-400 opacity-50 cursor-not-allowed'} py-1 rounded text-xs font-bold transition border border-blue-200">${p.Fraccion_Tipo}</button>
                    </div>`;
            }

            return `<div class="bg-white border border-gray-200 p-3 rounded-xl cursor-pointer transition flex flex-col justify-between ${stock<=0?'opacity-50 cursor-not-allowed':'hover:border-accent hover:shadow-md'}" ${stock>0?`onclick="addToCart('${p.ID_Producto}', false, ${p.Precio_Venta}, '${p.Nombre}', ${p.Costo_Compra})"`:''}>
                <p class="font-bold text-sm leading-tight text-primary">${p.Nombre}</p>
                ${p.Marca ? `<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold inline-block mt-1 self-start">${p.Marca}</span>` : ''}
                ${actionHtml}
            </div>`;
        };

        // Tarjeta de paquete del POS
        const posPaqueteCardHTML = (p) => {
            let its = []; try { its = JSON.parse(p.Productos_JSON||'[]'); } catch(e){}
            const pkgDesc = its.map(i => `${i.cantidad}x ${i.name || i.nombre}`).join(' | ');
            return `<div class="bg-primary border border-primary p-3 rounded-xl cursor-pointer hover:ring-2 hover:ring-accent transition flex flex-col justify-between" onclick="addToCart('${p.ID_Paquete}', true, ${p.Precio_Combo}, '${p.Nombre_Paquete}', 0)" title="${pkgDesc}">
                <p class="font-bold text-sm leading-tight text-accent"><i class="fa-solid fa-gift mr-1"></i> ${p.Nombre_Paquete}</p>
                <div class="mt-3 text-right"><span class="font-black text-white">${fMoney(p.Precio_Combo)}</span></div>
            </div>`;
        };

        // Alertas de stock bajo y vencimiento arriba del punto de venta
        const checkLowStockCaja = window.checkLowStockCaja = () => {
            const cont = document.getElementById('caja-alertas-stock');
            const lista = document.getElementById('caja-alertas-lista');
            if (!cont || !lista) return;

            const hoy = new Date(sysTime(true) + 'T00:00:00');
            const limite = new Date(hoy); limite.setDate(limite.getDate() + 30);
            let items = [];

            (DB.Productos || []).forEach(p => {
                const stock = toNum(p.Existencias);
                if (stock <= toNum(p.Alerta_Minimo)) {
                    items.push(`<span class="bg-white border border-red-200 rounded px-2 py-1 whitespace-nowrap shrink-0"><b>${p.Nombre}</b> · quedan ${stock.toFixed(2).replace(/\.00$/, '')}</span>`);
                }
                if (p.Fecha_Caducidad) {
                    const vence = new Date(String(p.Fecha_Caducidad).split(' ')[0] + 'T00:00:00');
                    if (!isNaN(vence) && vence <= limite) {
                        const vencido = vence < hoy;
                        items.push(`<span class="bg-white border ${vencido ? 'border-red-400 text-red-700' : 'border-yellow-300 text-yellow-800'} rounded px-2 py-1 whitespace-nowrap shrink-0"><b>${p.Nombre}</b> · ${vencido ? 'vencido' : 'vence'} ${String(p.Fecha_Caducidad).split(' ')[0]}</span>`);
                    }
                }
            });

            lista.innerHTML = items.join('');
            cont.classList.toggle('hidden', items.length === 0);
        };

        window.renderPosCatalog = function renderPosCatalog() {
            const q = (document.getElementById('pos-search').value || '');
            const c = document.getElementById('pos-catalog');
            let html = '';
            
            // Búsqueda Directa
            if (q.trim() !== '') {
                activePosCategory = null; 
                updatePosMidHeader();
                renderPosCategories();

                applyProductFilter(q).forEach(p => {
                    html += posProductoCardHTML(p);
                });

                (DB.Paquetes || []).filter(p => (p.Nombre_Paquete || '').toLowerCase().includes(q.toLowerCase()) && p.Estado==='Activo')
                    .forEach(p => { html += posPaqueteCardHTML(p); });
                c.innerHTML = html;
                return;
            }

            if (activePosCategory === 'PAQUETES') {
                (DB.Paquetes || []).filter(p => p.Estado==='Activo').forEach(p => { html += posPaqueteCardHTML(p); });
            } else if (activePosCategory) {
                (DB.Productos || []).filter(p => p.ID_Categoria === activePosCategory).forEach(p => {
                    html += posProductoCardHTML(p);
                });
            }
            c.innerHTML = html;
        }

        const validateCartStock = (testCart) => {
            const demands = {};
            for (const item of testCart) {
                if (item.isPaquete) {
                    const p = DB.Paquetes.find(x => x.ID_Paquete === item.id);
                    if (p) {
                        let its = []; try { its = JSON.parse(p.Productos_JSON || '[]'); } catch(e){}
                        its.forEach(sub => {
                            demands[sub.id] = (demands[sub.id] || 0) + (sub.cantidad * item.cantidad);
                        });
                    }
                } else {
                    const p = DB.Productos.find(x => x.ID_Producto === item.id);
                    if (p) {
                        const deduction = item.isFraction ? (item.cantidad * (1 / (p.Fraccion_Cant || 1))) : item.cantidad;
                        demands[item.id] = (demands[item.id] || 0) + deduction;
                    }
                }
            }
            
            for (const id in demands) {
                const pr = DB.Productos.find(x => x.ID_Producto === id);
                if (pr) {
                    if (demands[id] > Number(pr.Existencias)) {
                        return { valid: false, productName: pr.Nombre, max: Number(pr.Existencias) };
                    }
                }
            }
            return { valid: true };
        };

        const addToCart = window.addToCart = (id, isPkg, price, name, cost, isFraction = false) => {
            if(!checkUserActive()) return;
            
            let testCart = JSON.parse(JSON.stringify(cart));
            const ex = testCart.find(x => x.id === id && x.isFraction === isFraction);
            if(ex) {
                ex.cantidad++;
            } else {
                testCart.push({ id, isPaquete: isPkg, precio: price, nombre: name, costo: cost, cantidad: 1, isFraction: isFraction });
            }
            
            const val = validateCartStock(testCart);
            if (!val.valid) {
                return showToast(`No puede agregarse: "${val.productName}" está agotado o excede existencias. (Máximo: ${Math.floor(val.max)})`, "error");
            }
            
            cart = testCart;
            renderCart();
        };

        const updateCartQty = window.updateCartQty = (idx, val) => {
            const qty = Number(val);
            if(qty > 0) {
                let testCart = JSON.parse(JSON.stringify(cart));
                testCart[idx].cantidad = qty;
                
                const valid = validateCartStock(testCart);
                if (!valid.valid) {
                    renderCart();
                    return showToast(`No puede exceder las existencias disponibles de "${valid.productName}". (Máximo: ${Math.floor(valid.max)})`, "error");
                }
                cart = testCart;
            } else {
                cart.splice(idx, 1);
            }
            renderCart();
        };

        const renderCart = window.renderCart = () => {
            const c = document.getElementById('pos-cart'); c.innerHTML = '';
            let t = 0;
            if(!cart.length) c.innerHTML = '<p class="text-sm text-gray-400 text-center mt-10">Cesta vacía</p>';
            cart.forEach((i, idx) => {
                t += (i.precio * i.cantidad);
                c.innerHTML += `<div class="flex flex-col gap-2 bg-gray-50 p-2 rounded border border-gray-100">
                    <div><p class="text-sm font-bold text-primary leading-tight">${i.nombre}</p></div>
                    <div class="flex justify-between items-center">
                        <p class="text-xs text-gray-500 font-semibold mt-1">${fMoney(i.precio)} c/u</p>
                        <div class="flex items-center gap-2">
                            <div class="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
                                <button onclick="updateCartQty(${idx}, ${i.cantidad - 1})" class="px-2.5 py-1 text-gray-500 hover:bg-gray-100 hover:text-red-500 transition"><i class="fa-solid fa-minus text-[10px]"></i></button>
                                <span class="w-8 text-center text-sm font-bold text-primary">${i.cantidad}</span>
                                <button onclick="updateCartQty(${idx}, ${i.cantidad + 1})" class="px-2.5 py-1 text-gray-500 hover:bg-gray-100 hover:text-accent transition"><i class="fa-solid fa-plus text-[10px]"></i></button>
                            </div>
                            <button onclick="updateCartQty(${idx}, 0)" class="text-red-500 w-6 hover:text-red-700 transition ml-1"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                </div>`;
            });
            document.getElementById('pos-total').innerText = fMoney(t);
        };
        
        // AUTOCOMPLETADO DE CLIENTES EN POS
        function updateClientesDatalist() {
            const dl = document.getElementById('dl-clientes');
            if(!dl) return;
            dl.innerHTML = '';
            const uniqueNits = new Set();
            (DB.Ventas_Facturas || []).forEach(f => {
                if(f.Cliente_NIT && f.Cliente_NIT !== 'CF' && !uniqueNits.has(f.Cliente_NIT)) {
                    uniqueNits.add(f.Cliente_NIT);
                    dl.innerHTML += `<option value="${f.Cliente_NIT}">${f.Cliente_Nombre} ${f.Cliente_Apellido || ''}</option>`;
                }
            });
        }
        
        const autofillCliente = window.autofillCliente = () => {
            const nit = document.getElementById('cli-nit').value;
            const fac = DB.Ventas_Facturas.find(f => f.Cliente_NIT === nit && f.Cliente_Nombre !== 'C/F');
            if(fac) {
                if (!document.getElementById('cli-nombre').value) document.getElementById('cli-nombre').value = fac.Cliente_Nombre || '';
                if (!document.getElementById('cli-apellido').value) document.getElementById('cli-apellido').value = fac.Cliente_Apellido || '';
                if (!document.getElementById('cli-email').value) document.getElementById('cli-email').value = fac.Cliente_Email || '';
                if (!document.getElementById('cli-tel').value) document.getElementById('cli-tel').value = fac.Cliente_Telefono || '';
                document.getElementById('cli-cf').checked = false;
            }
        };
        
        const toggleCF = window.toggleCF = () => {
            const isCF = document.getElementById('cli-cf').checked;
            if (isCF) {
                document.getElementById('cli-nit').value = 'CF';
                if(!document.getElementById('cli-nombre').value) document.getElementById('cli-nombre').value = 'Consumidor Final';
            } else {
                if(document.getElementById('cli-nit').value === 'CF') document.getElementById('cli-nit').value = '';
                if(document.getElementById('cli-nombre').value === 'Consumidor Final') document.getElementById('cli-nombre').value = '';
            }
        };

        const openCheckoutModal = window.openCheckoutModal = () => {
            if(!checkUserActive()) return;
            if(!cart.length) return showToast("Cesta vacía", "error");
            
            // Limpiar modal previo
            document.getElementById('cli-cf').checked = false;
            document.getElementById('cli-nit').value = '';
            document.getElementById('cli-nombre').value = '';
            document.getElementById('cli-apellido').value = '';
            document.getElementById('cli-email').value = '';
            document.getElementById('cli-tel').value = '';
            
            document.getElementById('chk-entrega').value = 'En Farmacia';
            document.getElementById('chk-direccion').value = '';
            toggleEntrega();

            document.getElementById('chk-total').innerText = document.getElementById('pos-total').innerText;
            document.getElementById('chk-descuento').value = 0;
            openModal('mod-checkout');
        };
        
        const calcDescuento = window.calcDescuento = () => {
            const t = Number(cart.reduce((s,i)=>s+(i.precio*i.cantidad),0).toFixed(2));
            const descGlobal = Number(document.getElementById('chk-descuento').value||0);
            document.getElementById('chk-total').innerText = fMoney(t - descGlobal);
        };

        const toggleEntrega = window.toggleEntrega = () => {
            const ent = document.getElementById('chk-entrega').value;
            const div = document.getElementById('div-direccion');
            if(ent === 'A Domicilio') div.classList.remove('hidden');
            else div.classList.add('hidden');
        };

                const processCheckout = window.processCheckout = async () => {
            if(!checkUserActive()) return;
            const sub = Number(cart.reduce((s,i)=>s+(i.precio*i.cantidad),0).toFixed(2));
            const totalCosto = Number(cart.reduce((s,i)=>s+(i.costo*i.cantidad),0).toFixed(2));
            const descGlobal = Number(document.getElementById('chk-descuento').value || 0);
            const t = sub - descGlobal;
            
            if (t < totalCosto) {
                if(!confirm(`¡Atención! El total a cobrar (Q${t.toFixed(2)}) es MENOR que el costo total de los productos (Q${totalCosto.toFixed(2)}). ¿Está seguro de procesar esta venta con pérdidas?`)) {
                    return;
                }
            }
            
            const n = document.getElementById('cli-nombre').value;
            const nit = document.getElementById('cli-nit').value || 'CF';
            const apellido = document.getElementById('cli-apellido').value;
            const email = document.getElementById('cli-email').value;
            const tel = document.getElementById('cli-tel').value;
            const metodoPago = document.getElementById('chk-metodo').value;
            const entrega = document.getElementById('chk-entrega').value;
            const direccion = document.getElementById('chk-direccion').value;
            
            if(descGlobal < 0 || descGlobal > sub) return showToast("Descuento inválido (mayor al subtotal)", "error");
            if(entrega === 'A Domicilio' && !direccion.trim()) return showToast("La dirección de envío es obligatoria", "error");

            // HALLAZGO 11: Usar función centralizada para isFraccionada
            const snap = cart.map(i => ({ id: i.id, nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, subtotal: i.precio*i.cantidad, isPaquete: i.isPaquete, isFraction: esVentaFraccionada(i) }));
            // HALLAZGO 9: Agregar sufijo aleatorio a IDs para evitar colisiones
            const randomSuffix = Math.random().toString(36).substr(2, 9);
            const fid = 'REC-' + Date.now() + '-' + randomSuffix;

            const facData = {
                ID_Factura: fid, Fecha: sysTime(), 
                Cliente_Nombre: n || 'C/F', Cliente_NIT: nit,
                Cliente_Apellido: apellido, Cliente_Email: email, Cliente_Telefono: tel,
                Cajero: activeAppUser ? activeAppUser.Nombre : 'Admin',
                Subtotal: sub, Descuento_Global: descGlobal, Total_Pagar: t, 
                Monto_Pagado: t, Saldo_Pendiente: 0, Estado_Pago: 'Pagado',
                Metodo_Pago: metodoPago,
                Tipo_Entrega: entrega, Direccion_Envio: entrega === 'A Domicilio' ? direccion.trim() : '',
                Estatus: 'Completado', Items_JSON: JSON.stringify(snap)
            };

            // HALLAZGO 3: Validación de stock negativo ANTES de procesar
            // Verificar que todos los productos tengan stock suficiente
            for (const item of cart) {
                if(item.isPaquete) {
                    const p = DB.Paquetes.find(x=>x.ID_Paquete===item.id);
                    if(p){
                        let its = [];
                        try { its = JSON.parse(p.Productos_JSON||'[]'); } catch(e){}
                        for (const c of its) {
                            const subP = DB.Productos.find(x=>x.ID_Producto===c.id);
                            const requiredQty = c.cantidad * item.cantidad;
                            if(subP && Number(subP.Existencias) < requiredQty) {
                                showToast(`Stock insuficiente de ${subP.Nombre}. Disponible: ${subP.Existencias}, Requerido: ${requiredQty}`, "error");
                                return; // Rechazar la venta
                            }
                        }
                    }
                } else {
                    const p = DB.Productos.find(x=>x.ID_Producto===item.id);
                    if(p){
                        const deduction = esVentaFraccionada(item) ? (item.cantidad * (1 / (p.Fraccion_Cant || 1))) : item.cantidad;
                        if(Number(p.Existencias) < deduction) {
                            showToast(`Stock insuficiente de ${p.Nombre}. Disponible: ${p.Existencias}, Requerido: ${deduction}`, "error");
                            return; // Rechazar la venta
                        }
                    }
                }
            }

            // Local Update (Deduct Stock & save Fac)
            // Solo se ajusta la copia local para que la pantalla responda al instante.
            // El descuento real en la hoja lo hace checkoutSession en el backend:
            // si tambien lo mandaramos por 'crud' el stock se restaria dos veces.
            cart.forEach(item => {
                if(item.isPaquete) {
                    const p = DB.Paquetes.find(x=>x.ID_Paquete===item.id);
                    if(p){
                        let its = [];
                        try { its = JSON.parse(p.Productos_JSON||'[]'); } catch(e){}
                        its.forEach(c => {
                            const subP = DB.Productos.find(x=>x.ID_Producto===c.id);
                            if(subP) subP.Existencias = Number(subP.Existencias) - (c.cantidad * item.cantidad);
                        });
                    }
                } else {
                    const p = DB.Productos.find(x=>x.ID_Producto===item.id);
                    if(p){
                        // HALLAZGO 11: Usar función centralizada
                        const deduction = esVentaFraccionada(item) ? (item.cantidad * (1 / (p.Fraccion_Cant || 1))) : item.cantidad;
                        p.Existencias = Number(p.Existencias) - deduction;
                    }
                }
            });

            DB.Ventas_Facturas.push(facData);
            
            closeModal('mod-checkout');
            cart = [];
            renderCart();
            document.getElementById('pos-search').value = '';
            
            // Re-render
            updatePosMidHeader();
            renderPosCategories();
            renderPosCatalog(); 
            renderProductos();
            checkLowStockCaja();
            renderPaquetes();
            renderFinanzas(); 
            renderDashboard();
            updateClientesDatalist();
            generateReceipt(fid, metodoPago);
            
            // Background Sync
            apiCall('checkoutSession', { facturaData: facData, itemsCesta: snap });
        };window.generateReceipt = function generateReceipt(facturaId, metodoPago = 'Efectivo') {
            const fac = DB.Ventas_Facturas.find(x => x.ID_Factura === facturaId);
            if(!fac) return;

            document.getElementById('rec-clinic-name').innerText = DB.Configuracion.find(c => c.Clave === 'StoreName')?.Valor || 'Farmacia OS';
            
            document.getElementById('rec-fact-id').innerText = fac.ID_Factura;
            document.getElementById('rec-pat').innerText = `${fac.Cliente_Nombre} (NIT: ${fac.Cliente_NIT})`;
            document.getElementById('rec-doc').innerText = fac.Cajero || 'Admin';
            document.getElementById('rec-date').innerText = formatDisplayDate(fac.Fecha);
            document.getElementById('rec-metodo').innerText = fac.Metodo_Pago || metodoPago;
            document.getElementById('rec-entrega').innerText = fac.Tipo_Entrega || 'En Farmacia';
            
            if (fac.Tipo_Entrega === 'A Domicilio') {
                document.getElementById('rec-div-dir').classList.remove('hidden');
                document.getElementById('rec-dir').innerText = fac.Direccion_Envio || '';
            } else {
                document.getElementById('rec-div-dir').classList.add('hidden');
            }
            
            let itemsHtml = '';
            try {
                const items = JSON.parse(fac.Items_JSON || '[]');
                items.forEach(i => {
                    const isPkg = i.isCombo || i.isPaquete;
                    const p = isPkg ? DB.Paquetes.find(x=>x.ID_Paquete===i.id) : DB.Productos.find(x=>x.ID_Producto===i.id);
                    const name = p ? (p.Nombre || p.Nombre_Paquete) : 'Producto Desconocido';
                    itemsHtml += `<div class="flex justify-between border-b border-gray-100 pb-1">
                        <span>${i.cantidad}x ${name}</span>
                        <span class="font-bold">${fMoney((i.precio || i.precio_momento || 0) * i.cantidad)}</span>
                    </div>`;
                });
            } catch(e) {}
            
            document.getElementById('rec-notes').innerHTML = itemsHtml || "Sin detalles disponibles.";
            document.getElementById('rec-total').innerText = fMoney(fac.Total_Pagar);

            const btnAnular = document.getElementById('btn-anular-recibo');
            if(btnAnular) {
                if(fac.Estatus === 'Cancelado') btnAnular.style.display = 'none';
                else btnAnular.style.display = '';
            }

            openModal('modal-receipt');
        };

        window.anularFactura = function(facturaId) {
            if(!checkUserActive()) return;
            const fac = DB.Ventas_Facturas.find(x => x.ID_Factura === facturaId);
            if(!fac) return showToast("Factura no encontrada", "error");
            if(fac.Estatus === 'Cancelado') return showToast("La factura ya está cancelada", "error");
            
            if(!confirm("¿Está seguro que desea anular este recibo? Los productos regresarán al inventario.")) return;
            
            try {
                const items = JSON.parse(fac.Items_JSON || '[]');
                items.forEach(i => {
                    const isPkg = i.isCombo || i.isPaquete;
                    if(isPkg) {
                        const p = DB.Paquetes.find(x=>x.ID_Paquete===i.id);
                        if(p) {
                            let its = [];
                            try { its = JSON.parse(p.Productos_JSON||'[]'); } catch(e){}
                            its.forEach(c => {
                                const subP = DB.Productos.find(x=>x.ID_Producto===c.id);
                                if(subP) {
                                    subP.Existencias = Number(subP.Existencias) + (c.cantidad * i.cantidad);
                                    apiCall('crud', { sheetName: 'Productos', operation: 'update', rowData: subP, idField: 'ID_Producto', idValue: subP.ID_Producto });
                                }
                            });
                        }
                    } else {
                        const p = DB.Productos.find(x=>x.ID_Producto===i.id);
                        if(p) {
                            // HALLAZGO 11: Usar función centralizada
                            const deduction = esVentaFraccionada(i) ? (i.cantidad * (1 / (p.Fraccion_Cant || 1))) : i.cantidad;
                            p.Existencias = Number(p.Existencias) + deduction;
                            apiCall('crud', { sheetName: 'Productos', operation: 'update', rowData: p, idField: 'ID_Producto', idValue: p.ID_Producto });
                        }
                    }
                });
            } catch(e) {
                console.error(e);
                return showToast("Error al devolver el inventario", "error");
            }

            fac.Estatus = 'Cancelado';
            apiCall('crud', { sheetName: 'Ventas_Facturas', operation: 'update', rowData: fac, idField: 'ID_Factura', idValue: fac.ID_Factura });

            // HALLAZGO 5: Crear llamada a processVoidSale en el backend
            const voidPayload = {
                facturaId: facturaId,
                facturaData: fac,
                items: (() => {
                    try { return JSON.parse(fac.Items_JSON || '[]'); }
                    catch(e) { return []; }
                })()
            };
            apiCall('processVoidSale', voidPayload);

            logAudit('Finanzas', 'Anular Recibo', `Recibo ID: ${facturaId}`);
            
            showToast("Recibo Anulado. Inventario restaurado.", "success");
            closeModal('modal-receipt');
            
            renderFinanzas();
            renderDashboard();
            renderPosCatalog();
            renderProductos();
        };

        // --- FINANZAS, GASTOS Y TAREAS ---
        let sortFacturas = { col: 'fecha', asc: false };
        let sortGastos = { col: 'fecha', asc: false };

        window.toggleSortFacturas = (col) => {
            if(sortFacturas.col === col) sortFacturas.asc = !sortFacturas.asc;
            else { sortFacturas.col = col; sortFacturas.asc = true; }
            renderFinanzas();
        };

        window.toggleSortGastos = (col) => {
            if(sortGastos.col === col) sortGastos.asc = !sortGastos.asc;
            else { sortGastos.col = col; sortGastos.asc = true; }
            renderFinanzas();
        };

        window.renderFinanzas = function renderFinanzas() {
            const ds = document.getElementById('fin-date-start')?.value;
            const de = document.getElementById('fin-date-end')?.value;
            const checkDate = makeDateFilter(ds, de);

            console.log('[RENDER FINANZAS] Filtro fecha:', {desde: ds, hasta: de});

            renderCajaPanel();

            const ft = document.getElementById('tbl-facturas'); ft.innerHTML = '';
            const fFiltered = (DB.Ventas_Facturas || []).filter(x => checkDate(x.Fecha));
            console.log('[FINANZAS] Recibos filtrados:', fFiltered.length, 'de', DB.Ventas_Facturas.length);
            fFiltered.sort((a,b) => {
                let vA, vB;
                if(sortFacturas.col === 'fecha') { vA = parseDateToInt(a.Fecha); vB = parseDateToInt(b.Fecha); }
                else if(sortFacturas.col === 'id') { vA = a.ID_Factura; vB = b.ID_Factura; }
                else if(sortFacturas.col === 'cliente') { vA = a.Cliente_Nombre; vB = b.Cliente_Nombre; }
                else if(sortFacturas.col === 'total') { vA = Number(a.Total_Pagar); vB = Number(b.Total_Pagar); }
                
                if (vA < vB) return sortFacturas.asc ? -1 : 1;
                if (vA > vB) return sortFacturas.asc ? 1 : -1;
                return 0;
            }).slice(0, 50).forEach(f => {
                ft.innerHTML += `<tr class="hover:bg-gray-50 cursor-pointer" onclick="generateReceipt('${f.ID_Factura}', '${f.Metodo_Pago||'Efectivo'}')">
                    <td class="p-3 font-mono text-gray-500 text-xs">${f.ID_Factura}</td>
                    <td class="p-3 text-xs">${formatDisplayDate(f.Fecha)}</td>
                    <td class="p-3 font-bold text-sm text-primary">${f.Cliente_Nombre} ${f.Cliente_Apellido||''}</td>
                    <td class="p-3 text-sm"><span class="font-black text-primary">${fMoney(f.Total_Pagar)}</span></td>
                    <td class="p-3"><span class="px-2 py-1 text-[10px] font-bold uppercase rounded ${f.Estatus==='Cancelado'?'bg-red-100 text-red-600':'bg-accent/20 text-darkaccent'}">${f.Estatus || 'Completado'}</span></td>
                </tr>`;
            });
            if(!fFiltered.length) ft.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-gray-500">Sin registros</td></tr>`;

            const gt = document.getElementById('tbl-gastos'); gt.innerHTML = '';
            const gFiltered = (DB.Gastos || []).filter(x => checkDate(x.Fecha));
            console.log('[FINANZAS] Gastos filtrados:', gFiltered.length, 'de', DB.Gastos.length);

            // Ordenar y renderizar gastos
            if (gFiltered.length > 0) {
                gFiltered.sort((a,b) => {
                    let vA, vB;
                    const col = sortGastos?.col || 'fecha';
                    if(col === 'fecha') { vA = parseDateToInt(a.Fecha); vB = parseDateToInt(b.Fecha); }
                    else if(col === 'concepto') { vA = (a.Concepto||'').toLowerCase(); vB = (b.Concepto||'').toLowerCase(); }
                    else if(col === 'tipo') { vA = a.Tipo; vB = b.Tipo; }
                    else if(col === 'monto') { vA = Number(a.Monto); vB = Number(b.Monto); }
                    else if(col === 'ref') {
                        const matchA = (a.Concepto||'').match(/\[ID:\s*(.*?)\]/);
                        const matchB = (b.Concepto||'').match(/\[ID:\s*(.*?)\]/);
                        vA = matchA ? matchA[1] : ''; vB = matchB ? matchB[1] : '';
                    }

                    const asc = sortGastos?.asc !== false;
                    if (vA < vB) return asc ? -1 : 1;
                    if (vA > vB) return asc ? 1 : -1;
                    return 0;
                });
            }

            gFiltered.slice(0, 50).forEach(g => {
                const match = (g.Concepto||'').match(/\[ID:\s*(.*?)\]/);
                const ref = match ? match[1] : '-';
                const conceptoDisplay = (g.Concepto||'').replace(/\[ID:\s*.*?\]/, '').trim();

                gt.innerHTML += `<tr class="hover:bg-gray-50">
                    <td class="p-3 text-xs text-gray-500">${formatDisplayDate(g.Fecha)}</td>
                    <td class="p-3 font-mono text-[10px] text-gray-400">${ref}</td>
                    <td class="p-3 font-bold text-sm text-primary">${conceptoDisplay}</td>
                    <td class="p-3 text-xs uppercase text-gray-500">${g.Tipo}</td>
                    <td class="p-3 font-black text-red-500">${fMoney(g.Monto)}</td>
                    <td class="p-3 text-right">
                        <button onclick="editGasto('${g.ID_Gasto}')" class="text-blue-500 hover:text-blue-700 mr-2" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteGasto('${g.ID_Gasto}')" class="text-red-500 hover:text-red-700" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`;
            });
            if(!gFiltered.length) gt.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-gray-500">Sin registros</td></tr>`;

            const ct = document.getElementById('tbl-caja-historial'); 
            if(ct) {
                ct.innerHTML = '';
                const cFiltered = (DB.Caja_Mensual || []).filter(x => checkDate(x.fecha_registro));
                cFiltered.sort((a,b) => {
                    let vA = parseDateToInt(a.fecha_registro), vB = parseDateToInt(b.fecha_registro);
                    return vB - vA;
                }).forEach(c => {
                    const dif = toNum(c.diferencia);
                    const difColor = Math.abs(dif) < 0.005 ? 'text-gray-400' : (dif < 0 ? 'text-red-600' : 'text-green-600');
                    const saldoFinal = (c.saldo_final === undefined || c.saldo_final === null || c.saldo_final === '')
                        ? toNum(c.total_recaudado) - toNum(c.efectivo_entregado)
                        : toNum(c.saldo_final);
                    ct.innerHTML += `<tr class="hover:bg-gray-50">
                        <td class="p-3 text-xs text-gray-500 font-mono"><div class="font-bold text-gray-700">${c.id}</div>${formatDisplayDate(c.fecha_registro)}</td>
                        <td class="p-3 text-sm font-bold text-primary">${c.mes_año}</td>
                        <td class="p-3 text-right text-gray-500">${c.efectivo_esperado === undefined || c.efectivo_esperado === '' ? '-' : fMoney(c.efectivo_esperado)}</td>
                        <td class="p-3 text-right font-black text-gray-600">${fMoney(c.total_recaudado)}</td>
                        <td class="p-3 text-right font-bold ${difColor}">${fMoney(dif)}</td>
                        <td class="p-3 text-right font-black text-green-600">${fMoney(c.efectivo_entregado)}</td>
                        <td class="p-3 text-right font-black text-blue-600">${fMoney(saldoFinal)}</td>
                        <td class="p-3 text-xs text-gray-500 max-w-xs truncate" title="${c.observaciones || ''}">${c.observaciones || '-'}</td>
                    </tr>`;
                });
                if(!cFiltered.length) ct.innerHTML = `<tr><td colspan="8" class="p-3 text-center text-gray-500">Sin registros de cierre</td></tr>`;
            }
        }

        window.exportVentasCSV = () => {
            let csvContent = "Recibo No.,Fecha,Cliente,Metodo de Pago,Total,Estado\n";
            const checkDate = makeDateFilter(document.getElementById('fin-date-start')?.value, document.getElementById('fin-date-end')?.value);
            const filtered = (DB.Ventas_Facturas || []).filter(x => checkDate(x.Fecha));

            filtered.forEach(fac => {
                const id = fac.ID_Factura || '';
                const date = formatDisplayDate(fac.Fecha);
                const cliente = (fac.Cliente_Nombre || '').replace(/"/g, '""');
                const metodo = fac.Metodo_Pago || 'Efectivo';
                const total = Number(fac.Total_Pagar || 0).toFixed(2);
                const estado = fac.Estatus || fac.Estado_Pago || '';
                csvContent += `"${id}","${date}","${cliente}","${metodo}",${total},"${estado}"\n`;
            });

            downloadCSV('Reporte_Ventas', csvContent);
            showToast("Reporte Ventas Exportado", "success");
        };

        window.exportGastosCSV = () => {
            let csvContent = "Fecha,Ref,Concepto,Tipo,Monto\n";
            const checkDate = makeDateFilter(document.getElementById('fin-date-start')?.value, document.getElementById('fin-date-end')?.value);
            const filtered = (DB.Gastos || []).filter(x => checkDate(x.Fecha));
            
            filtered.forEach(g => {
                const date = formatDisplayDate(g.Fecha);
                const match = (g.Concepto||'').match(/\[ID:\s*(.*?)\]/);
                const ref = match ? match[1] : '-';
                const concepto = (g.Concepto||'').replace(/\[ID:\s*.*?\]/, '').trim().replace(/"/g, '""');
                const tipo = g.Tipo || '';
                const monto = Number(g.Monto || 0).toFixed(2);
                csvContent += `"${date}","${ref}","${concepto}","${tipo}",${monto}\n`;
            });

            downloadCSV('Reporte_Gastos', csvContent);
            showToast("Reporte Gastos Exportado", "success");
        };

        window.exportInventarioCSV = () => {
            let csvContent = "Cod/Nombre,Marca,Categoria,Costo,Margen,Precio Venta,Stock,Costo Total,Valor Venta,Ganancia Esperada\n";
            const q = (document.getElementById('srch-prod').value || '').toLowerCase();
            const filtered = applyProductFilter(q);
            
            filtered.forEach(p => {
                const catObj = (DB.Categorias || []).find(c => c.ID_Categoria === p.ID_Categoria);
                const catName = catObj ? catObj.Nombre_Categoria : p.ID_Categoria;
                const nombre = (p.Nombre || '').replace(/\n/g, ' - ').replace(/"/g, '""');
                const marca = (p.Marca || '').replace(/"/g, '""');
                const cat = (catName || '').replace(/"/g, '""');
                const costo = Number(p.Costo_Compra || 0);
                const mrg = Number(p.Margen_Ganancia || 0);
                const precio = Number(p.Precio_Venta || 0);
                const stock = Number(p.Existencias || 0);
                const ct = stock * costo;
                const vv = stock * precio;
                const ge = vv - ct;
                csvContent += `"${nombre}","${marca}","${cat}",${costo},${mrg},${precio},${stock},${ct},${vv},${ge}\n`;
            });

            downloadCSV('Reporte_Inventario', csvContent);
            showToast("Reporte Inventario Exportado", "success");
        };

        window.renderClientes = function renderClientes() {
            const tc = document.getElementById('tbl-clientes');
            tc.innerHTML = '';
            let uniqueClients = {};
            (DB.Ventas_Facturas || []).forEach(f => {
                if (ventaEsAnulada(f)) return;
                let emailVal = f.Cliente_Email || f['Cliente Email'] || f.cliente_email || f.email || f.Email;
                if (!emailVal) {
                    for (let k in f) { if (k.toLowerCase().includes('email')) { emailVal = f[k]; break; } }
                }
                if(emailVal && String(emailVal).includes('@')) {
                    if (!uniqueClients[emailVal]) {
                        uniqueClients[emailVal] = { name: f.Cliente_Nombre, apellido: f.Cliente_Apellido || '', tel: f.Cliente_Telefono || '', tickets: 0, total: 0, history: [] };
                    }
                    uniqueClients[emailVal].tickets++;
                    uniqueClients[emailVal].total += Number(f.Total_Pagar || 0);
                    uniqueClients[emailVal].history.push(f);
                }
            });

            window.currentClientesData = uniqueClients;
            
            const srch = (document.getElementById('srch-cliente')?.value || '').toLowerCase();

            Object.keys(uniqueClients).sort((a,b) => uniqueClients[b].total - uniqueClients[a].total).forEach(email => {
                const c = uniqueClients[email];
                const searchStr = `${c.name} ${c.apellido} ${email} ${c.tel}`.toLowerCase();
                if(srch && !searchStr.includes(srch)) return;
                
                tc.innerHTML += `<tr class="hover:bg-gray-50">
                    <td class="p-4 font-bold text-sm text-primary">${c.name} ${c.apellido}</td>
                    <td class="p-4 text-xs text-gray-500">${email}<br>${c.tel}</td>
                    <td class="p-4 font-black text-center text-accent">${c.tickets}</td>
                    <td class="p-4 font-black text-right text-primary">${fMoney(c.total)}</td>
                    <td class="p-4 text-center">
                        <button onclick="viewClienteHistorial('${email}')" class="bg-gray-100 hover:bg-primary hover:text-white text-gray-600 px-3 py-1 rounded text-xs font-bold transition">Ver Historial</button>
                    </td>
                </tr>`;
            });
            if(!tc.innerHTML) tc.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">No se encontraron clientes</td></tr>`;
        };
        
        window.exportClientesCSV = () => {
            let csvContent = "Cliente,Email,Telefono,Tickets Acumulados,Total Comprado\n";
            const tc = document.getElementById('tbl-clientes');
            tc.querySelectorAll('tr').forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if(tds.length === 5) {
                    const cliente = tds[0].innerText.replace(/"/g, '""');
                    const contactoLines = tds[1].innerText.split('\n');
                    const email = contactoLines[0] || '';
                    const tel = contactoLines[1] || '';
                    const tickets = tds[2].innerText;
                    const total = tds[3].innerText.replace(/["Q,]/g, '').trim();
                    csvContent += `"${cliente}","${email}","${tel}",${tickets},${total}\n`;
                }
            });
            
            downloadCSV('Reporte_Clientes', csvContent);
            showToast("Directorio de Clientes Exportado", "success");
        };

        window.viewClienteHistorial = function viewClienteHistorial(email) {
            const c = window.currentClientesData[email];
            if(!c) return;
            document.getElementById('lbl-cli-nombre').innerText = `Historial: ${c.name} ${c.apellido}`;
            const lst = document.getElementById('lst-cli-historial');
            lst.innerHTML = '';
            c.history.sort((a,b)=>parseDateToInt(b.Fecha) - parseDateToInt(a.Fecha)).forEach(f => {
                lst.innerHTML += `
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center">
                    <div>
                        <p class="font-bold text-primary">${f.ID_Factura}</p>
                        <p class="text-xs text-gray-500">${formatDisplayDate(f.Fecha)} | Cajero: ${f.Cajero}</p>
                    </div>
                    <div class="text-right">
                        <p class="font-black text-lg text-accent">${fMoney(f.Total_Pagar)}</p>
                        <p class="text-xs font-bold uppercase ${f.Estatus==='Cancelado'?'text-red-500':'text-green-500'}">${f.Estatus||'Completado'}</p>
                    </div>
                </div>`;
            });
            document.getElementById('mod-cliente-historial').classList.remove('hidden-view');
        };

        window.openNewGasto = () => {
            document.getElementById('gst-id').value = '';
            document.getElementById('gst-concepto').value = '';
            document.getElementById('gst-monto').value = '';
            document.getElementById('gst-tipo').value = 'Operativo';
            document.getElementById('gst-fue-caja').checked = false; // Por defecto: NO es dinero de caja
            openModal('mod-gasto');
        };

        window.editGasto = (id) => {
            const g = DB.Gastos.find(x => x.ID_Gasto === id);
            if(!g) return;
            document.getElementById('gst-id').value = g.ID_Gasto;
            document.getElementById('gst-concepto').value = g.Concepto;
            document.getElementById('gst-tipo').value = g.Tipo;
            document.getElementById('gst-monto').value = g.Monto;
            document.getElementById('gst-fue-caja').checked = String(g.Fue_De_Caja).toUpperCase() === 'SI' || g.Fue_De_Caja === 1 || g.Fue_De_Caja === true;
            openModal('mod-gasto');
        };

        window.deleteGasto = (id) => {
            if(!checkUserActive()) return;
            if(confirm('¿Seguro que desea eliminar este gasto?')) {
                const idx = DB.Gastos.findIndex(x => x.ID_Gasto === id);
                if(idx > -1) {
                    const g = DB.Gastos[idx];
                    DB.Gastos.splice(idx, 1);
                    renderFinanzas(); renderDashboard();
                    showToast("Gasto Eliminado");
                    apiCall('crud', { sheetName: 'Gastos', operation: 'delete', rowData: g, idField: 'ID_Gasto', idValue: id });
                    logAudit('Finanzas', 'Eliminar Gasto', `Gasto ID: ${id}`);
                }
            }
        };

        const saveGasto = window.saveGasto = async () => {
            if(!checkUserActive()) return;
            const idToEdit = document.getElementById('gst-id').value;
            const isEdit = !!idToEdit;

            const data = {
                ID_Gasto: isEdit ? idToEdit : ('GST-'+Date.now()),
                Fecha: isEdit ? DB.Gastos.find(g => g.ID_Gasto === idToEdit)?.Fecha || sysTime() : sysTime(),
                Tipo: document.getElementById('gst-tipo').value,
                Concepto: document.getElementById('gst-concepto').value,
                Monto: document.getElementById('gst-monto').value,
                Usuario: isEdit ? DB.Gastos.find(g => g.ID_Gasto === idToEdit)?.Usuario || getActiveUserName() : getActiveUserName(),
                Fue_De_Caja: document.getElementById('gst-fue-caja').checked ? 'SI' : 'NO'
            };

            if(!data.Concepto || !data.Monto) return showToast("Datos incompletos","error");

            if (isEdit) {
                const idx = DB.Gastos.findIndex(x => x.ID_Gasto === idToEdit);
                if (idx > -1) DB.Gastos[idx] = data;
            } else {
                DB.Gastos.push(data);
            }

            renderFinanzas(); renderDashboard();
            closeModal('mod-gasto');
            showToast(isEdit ? "Gasto Actualizado" : "Gasto Registrado");
            apiCall('crud', { sheetName: 'Gastos', operation: isEdit ? 'update' : 'create', rowData: data, idField: 'ID_Gasto', idValue: data.ID_Gasto });
            logAudit('Finanzas', isEdit ? 'Editar Gasto' : 'Crear Gasto', `Gasto por Q${data.Monto} (Caja: ${data.Fue_De_Caja})`);
        };

        window.renderTickets = function renderTickets() {
            ['pendientes', 'proceso', 'completadas'].forEach(id => document.getElementById(`tk-${id}`).innerHTML = '');
            
            const todayStr = sysTime(true);
            const pWeight = { 'Crítico': 4, 'Alta': 3, 'Media': 2, 'Baja': 1 };
            const sortedTickets = [...(DB.Tickets_Tareas || [])].sort((a,b) => {
                const pwA = pWeight[a.Prioridad] || 2;
                const pwB = pWeight[b.Prioridad] || 2;
                if(pwA !== pwB) return pwB - pwA;
                return parseDateToInt(b.Timestamp) - parseDateToInt(a.Timestamp);
            });
            
            let cPend = 0, cProc = 0, cComp = 0;

            sortedTickets.forEach(t => {
                const creationDate = t.Timestamp ? (String(t.Timestamp).split(' ')[0]||String(t.Timestamp).split('T')[0]) : '';
                const procDate = t.Fecha_Proceso || '';
                const compDate = t.Fecha_Completado || '';

                let stateColor = t.Estado === 'Completada' ? 'text-green-600' : (t.Estado === 'En Proceso' ? 'text-blue-600' : 'text-gray-500');
                
                let pColor = 'text-gray-500 bg-gray-100';
                if(t.Prioridad === 'Crítico') pColor = 'text-white bg-red-600 animate-pulse';
                else if(t.Prioridad === 'Alta') pColor = 'text-red-600 bg-red-100';
                else if(t.Prioridad === 'Baja') pColor = 'text-blue-600 bg-blue-100';

                const card = `<div class="bg-white p-4 rounded-xl shadow-sm border border-gray-200 cursor-pointer hover:border-accent transition relative" onclick="editTicket('${t.ID_Tarea}')">
                    <span class="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded ${pColor}">${t.Prioridad || 'Media'}</span>
                    <p class="font-bold text-sm text-primary leading-tight pr-12">${t.Titulo}</p>
                    <div class="flex flex-col gap-1 mt-3 text-[10px] text-gray-500 font-bold uppercase">
                        <div class="flex justify-between">
                            <span><i class="fa-solid fa-user"></i> Asig: ${t.Asignado_A||'Nadie'}</span>
                            <span class="${new Date(t.Fecha_Limite)<new Date()?'text-red-500':''}"><i class="fa-solid fa-flag"></i> Límite: ${t.Fecha_Limite||'N/A'}</span>
                        </div>
                        <div class="mt-1 text-gray-400">Creado por: ${t.Creado_Por || 'Sistema'}</div>
                        <div class="flex justify-between mt-1 pt-1 border-t border-gray-100 ${stateColor}">
                            <span>IN: ${formatDisplayDate(creationDate)}</span>
                            ${t.Estado === 'En Proceso' && procDate ? `<span>PROCESO: ${formatDisplayDate(procDate)}</span>` : ''}
                            ${t.Estado === 'Completada' && compDate ? `<span>FIN: ${formatDisplayDate(compDate)}</span>` : ''}
                        </div>
                    </div>
                </div>`;

                if (t.Estado === 'Pendiente' && cPend < 10) {
                    document.getElementById('tk-pendientes').innerHTML += card;
                    cPend++;
                } else if (t.Estado === 'En Proceso' && cProc < 10) {
                    document.getElementById('tk-proceso').innerHTML += card;
                    cProc++;
                } else if (t.Estado === 'Completada' && cComp < 10) {
                    if (creationDate === todayStr || t.Fecha_Completado === todayStr) {
                        document.getElementById('tk-completadas').innerHTML += card;
                        cComp++;
                    }
                }
            });
        }

        const openNewTicketModal = window.openNewTicketModal = () => {
            if(!checkUserActive()) return;
            document.getElementById('tk-id').value = ''; 
            document.getElementById('tk-titulo').value = '';
            document.getElementById('tk-desc').value = ''; 
            
            const selAsig = document.getElementById('tk-asig');
            selAsig.innerHTML = '<option value="">Sin Asignar</option>';
            (DB.Usuarios || []).forEach(u => {
                selAsig.innerHTML += `<option value="${u.Nombre}">${u.Nombre}</option>`;
            });
            selAsig.value = '';
            
            document.getElementById('tk-prioridad').value = 'Media';
            document.getElementById('tk-comentarios').value = '';
            document.getElementById('tk-fecha').value = ''; 
            document.getElementById('tk-estado').value = 'Pendiente';
            document.getElementById('tk-title-mod').innerText = "Nuevo Ticket"; 
            openModal('mod-ticket');
        };

        const editTicket = window.editTicket = (id) => {
            if(!checkUserActive()) return;
            const t = DB.Tickets_Tareas.find(x=>x.ID_Tarea===id);
            document.getElementById('tk-id').value = id; document.getElementById('tk-titulo').value = t.Titulo;
            document.getElementById('tk-desc').value = t.Descripcion; 
            
            const selAsig = document.getElementById('tk-asig');
            selAsig.innerHTML = '<option value="">Sin Asignar</option>';
            (DB.Usuarios || []).forEach(u => {
                selAsig.innerHTML += `<option value="${u.Nombre}">${u.Nombre}</option>`;
            });
            selAsig.value = t.Asignado_A || '';
            document.getElementById('tk-prioridad').value = t.Prioridad || 'Media';
            document.getElementById('tk-comentarios').value = t.Comentarios_Resolucion || '';
            document.getElementById('tk-fecha').value = t.Fecha_Limite; document.getElementById('tk-estado').value = t.Estado;
            document.getElementById('tk-title-mod').innerText = "Editar Ticket"; openModal('mod-ticket');
        };

        const saveTicket = window.saveTicket = async () => {
            if(!checkUserActive()) return;
            const id = document.getElementById('tk-id').value || 'TK-'+Date.now();
            const data = { 
                ID_Tarea: id, Titulo: document.getElementById('tk-titulo').value, Descripcion: document.getElementById('tk-desc').value, 
                Asignado_A: document.getElementById('tk-asig').value, Creado_Por: getActiveUserName(), Estado: document.getElementById('tk-estado').value, 
                Prioridad: document.getElementById('tk-prioridad').value, Comentarios_Resolucion: document.getElementById('tk-comentarios').value,
                Fecha_Limite: document.getElementById('tk-fecha').value 
            };
            
            const tIdx = DB.Tickets_Tareas.findIndex(x=>x.ID_Tarea===id);
            
            // Lógica para mantener timestamps de evolución
            if (!document.getElementById('tk-id').value) {
                data.Timestamp = sysTime();
            } else if (tIdx > -1) {
                data.Timestamp = DB.Tickets_Tareas[tIdx].Timestamp;
            }

            if (data.Estado === 'En Proceso' && (tIdx === -1 || DB.Tickets_Tareas[tIdx].Estado !== 'En Proceso')) {
                data.Fecha_Proceso = sysTime(true);
            } else if (tIdx > -1) {
                data.Fecha_Proceso = DB.Tickets_Tareas[tIdx].Fecha_Proceso || '';
            }

            if (data.Estado === 'Completada' && (tIdx === -1 || DB.Tickets_Tareas[tIdx].Estado !== 'Completada')) {
                data.Fecha_Completado = sysTime(true); 
            } else if (tIdx > -1) {
                data.Fecha_Completado = DB.Tickets_Tareas[tIdx].Fecha_Completado || '';
            }

            if(tIdx>-1) DB.Tickets_Tareas[tIdx] = data; else DB.Tickets_Tareas.push(data);
            renderTickets(); closeModal('mod-ticket'); showToast("Ticket Guardado");
            
            // Nota: Fecha_Proceso y Fecha_Completado se conservarán localmente.
            // Asegúrate de agregarlos a DB_SCHEMA de Tickets_Tareas en tu backend si quieres guardarlos permanentemente en Sheets.
            apiCall('crud', { sheetName: 'Tickets_Tareas', operation: document.getElementById('tk-id').value?'update':'create', rowData: data, idField: 'ID_Tarea', idValue: id });
            logAudit('Tareas', 'Crear/Editar Ticket', `Ticket ID: ${id}`);
        };

        // --- AUDITORIA ---
        window.renderAudit = function renderAudit() {
            const q = (document.getElementById('srch-audit')?.value || '').toLowerCase();
            const tb = document.getElementById('tbl-audit'); tb.innerHTML = '';
            (DB.Auditoria_Logs || []).filter(l => 
                String(l.Modulo||'').toLowerCase().includes(q) ||
                String(l.Accion||'').toLowerCase().includes(q) ||
                String(l.Detalles||'').toLowerCase().includes(q) ||
                String(l.Usuario||'').toLowerCase().includes(q) ||
                String(l.Timestamp||'').toLowerCase().includes(q)
            ).sort((a,b)=>parseDateToInt(b.Timestamp) - parseDateToInt(a.Timestamp)).forEach(l => {
                tb.innerHTML += `<tr class="hover:bg-gray-50"><td class="p-3 text-xs text-gray-500">${formatDisplayDate(l.Timestamp)}</td><td class="p-3 font-bold text-xs uppercase text-primary">${l.Modulo}</td><td class="p-3 text-accent font-bold">${l.Accion}</td><td class="p-3 text-xs text-gray-700">${l.Detalles}</td><td class="p-3 text-xs text-gray-400">${l.Usuario}</td></tr>`;
            });
            if(!tb.innerHTML) tb.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay registros de auditora.</td></tr>`;
        }

        // --- EFECTIVO EN CAJA -----------------------------------------------
        const CFG_CAJA_BASE = 'CajaBaseInicial';
        const CFG_CAJA_FECHA = 'CajaFechaInicio';

        const getConfigValor = (clave, porDefecto = '') => {
            const c = (DB.Configuracion || []).find(x => String(x.Clave).trim() === clave);
            return (c && c.Valor !== undefined && c.Valor !== '') ? c.Valor : porDefecto;
        };

        const getCajaOpts = () => ({
            baseInicial: getConfigValor(CFG_CAJA_BASE, 0),
            fechaBase: getConfigValor(CFG_CAJA_FECHA, '')
        });

        const renderCajaPanel = window.renderCajaPanel = () => {
            const elSaldo = document.getElementById('caja-saldo');
            if (!elSaldo) return;

            const e = calcularEstadoCaja(DB, getCajaOpts());
            elSaldo.innerText = fMoney(e.saldo);
            elSaldo.className = 'text-4xl font-black mt-1 leading-none ' + (e.saldo < 0 ? 'text-red-400' : 'text-white');

            document.getElementById('caja-lbl-ancla').innerText = e.anclaEtiqueta;
            document.getElementById('caja-ancla').innerText = fMoney(e.ancla);
            document.getElementById('caja-ventas').innerText = fMoney(e.ventasEfectivo);
            document.getElementById('caja-gastos').innerText = fMoney(e.gastos);
            document.getElementById('caja-ganancia').innerText = fMoney(e.gananciaBruta);

            const desde = document.getElementById('caja-desde');
            if (!e.hayBase) {
                desde.innerHTML = '<span class="text-yellow-400 font-bold">Falta la base: tocá "Ajustar base" para arrancar el conteo</span>';
            } else if (e.anclaFecha) {
                desde.innerText = `Movimientos desde ${formatDisplayDate(e.anclaFecha)}`;
            } else {
                desde.innerText = 'Movimientos desde el inicio del historial';
            }
        };

        window.openCajaBase = () => {
            if(!checkUserActive()) return;
            document.getElementById('caja-base-monto').value = toNum(getConfigValor(CFG_CAJA_BASE, 0));
            document.getElementById('caja-base-fecha').value = String(getConfigValor(CFG_CAJA_FECHA, '')).split(' ')[0];
            openModal('mod-caja-base');
        };

        window.saveCajaBase = async () => {
            console.log('[BASE] 1. boton presionado');

            if(!checkUserActive()) { console.warn('[BASE] CORTADO: no hay turno activo (checkUserActive dio false)'); return; }
            console.log('[BASE] 2. turno ok, rol =', userRole);

            const monto = Number(document.getElementById('caja-base-monto').value || 0);
            const fecha = document.getElementById('caja-base-fecha').value;
            console.log('[BASE] 3. monto =', monto, '| fecha del formulario =', fecha);

            if (!fecha) { console.warn('[BASE] CORTADO: no se eligió fecha'); return showToast("Elegí desde qué fecha arranca el conteo", "error"); }

            // Si la fecha elegida es HOY, se guarda con la hora exacta de este momento.
            // Si solo se guardara el dia, el conteo arrancaria a medianoche y volveria
            // a tragarse todo lo que se registro hoy mas temprano (por ejemplo la carga
            // de inventario). Para fechas pasadas se cuenta el dia completo.
            const fechaGuardar = (fecha === sysTime(true)) ? sysTime() : (fecha + ' 00:00:00');
            console.log('[BASE] 4. hoy es', sysTime(true), '| se va a guardar la fecha', fechaGuardar);

            // Primero se refleja en pantalla para que se vea el efecto de una vez...
            setConfigLocal(CFG_CAJA_BASE, monto);
            setConfigLocal(CFG_CAJA_FECHA, fechaGuardar);
            console.log('[BASE] 5. guardado en la copia local. Configuracion ahora:', JSON.parse(JSON.stringify(DB.Configuracion || [])));
            console.log('[BASE] 6. estado calculado del panel:', calcularEstadoCaja(DB, getCajaOpts()));
            renderCajaPanel();
            closeModal('mod-caja-base');

            // ...y hasta despues se avisa lo que DE VERDAD paso con la nube.
            // Antes se decia "guardada" antes de saberlo, y por eso parecia
            // que el boton no hacia nada.
            try {
                console.log('[BASE] 7. enviando a la hoja...');
                const r = await apiCall('updateConfig', { configData: { [CFG_CAJA_BASE]: monto, [CFG_CAJA_FECHA]: fechaGuardar } });
                console.log('[BASE] 8. respuesta de la hoja:', r);
                if (r === null) {
                    showToast('Base aplicada en pantalla, pero quedó PENDIENTE de subir a la hoja.', 'error');
                } else if (r.status === 'success') {
                    showToast(`✅ Base de caja guardada: Q${fMoney(monto)} desde ${fechaGuardar}`);
                    logAudit('Finanzas', 'Base de Caja', `Base ${fMoney(monto)} desde ${fechaGuardar}`);
                } else {
                    showToast(r.message || 'Error al guardar la base', 'error');
                }
            } catch(e) {
                showToast('No se pudo guardar la base en la hoja: ' + e.message, 'error');
            }
        };

        // --- CIERRE DE CAJA ---
        window.openCierreCaja = () => {
            if(!checkUserActive()) return;
            const e = calcularEstadoCaja(DB, getCajaOpts());
            const esperadoEl = document.getElementById('caja-esperado');
            esperadoEl.dataset.value = e.saldo;
            esperadoEl.innerText = fMoney(e.saldo);
            document.getElementById('caja-esperado-detalle').innerText =
                `${e.anclaEtiqueta} ${fMoney(e.ancla)} + ventas en efectivo ${fMoney(e.ventasEfectivo)} - gastos ${fMoney(e.gastos)}`;

            const ultimo = (DB.Caja_Mensual || []).slice()
                .sort((a,b) => parseDateToInt(a.fecha_registro) - parseDateToInt(b.fecha_registro)).pop();

            document.getElementById('caja-fisico').value = '';
            document.getElementById('caja-sencillo').value = ultimo ? toNum(ultimo.base_caja_sencillo) : 0;
            const entregarEl = document.getElementById('caja-entregar');
            entregarEl.value = '';
            delete entregarEl.dataset.touched;
            document.getElementById('caja-obs').value = '';

            recalcCierre();
            openModal('modal-caja');
        };

        // Recalcula diferencia, sugerencia de entrega y saldo que queda en caja.
        window.recalcCierre = () => {
            const esperado = Number(document.getElementById('caja-esperado').dataset.value || 0);
            const fisicoRaw = document.getElementById('caja-fisico').value;
            const fisico = Number(fisicoRaw || 0);
            const sencillo = Number(document.getElementById('caja-sencillo').value || 0);
            const entregarEl = document.getElementById('caja-entregar');

            if (!entregarEl.dataset.touched) {
                entregarEl.value = fisicoRaw === '' ? '' : Math.max(0, Number((fisico - sencillo).toFixed(2)));
            }
            const entregar = Number(entregarEl.value || 0);

            const dif = fisicoRaw === '' ? 0 : Number((fisico - esperado).toFixed(2));
            const difEl = document.getElementById('caja-diferencia');
            difEl.dataset.value = dif;
            difEl.innerText = (dif > 0 ? '+' : '') + fMoney(dif);
            difEl.className = 'text-lg font-black ' + (Math.abs(dif) < 0.005 ? 'text-gray-500' : (dif < 0 ? 'text-red-600' : 'text-green-600'));

            const saldoFinal = Number((fisico - entregar).toFixed(2));
            const sfEl = document.getElementById('caja-saldo-final');
            sfEl.dataset.value = saldoFinal;
            sfEl.innerText = fMoney(saldoFinal);
        };

        // CIERRE DE CAJA MEJORADO: permite Q0 si se retira TODO el efectivo
        window.saveCierreCaja = async () => {
            if(!checkUserActive()) return;
            const fisicoRaw = document.getElementById('caja-fisico').value;
            if (fisicoRaw === '') return showToast("Anotá el efectivo físico que contaste", "error");

            const fisico = Number(fisicoRaw) || 0;
            const sencillo = Number(document.getElementById('caja-sencillo').value) || 0;
            const entregar = Number(document.getElementById('caja-entregar').value) || 0;
            const esperado = Number(document.getElementById('caja-esperado').dataset.value || 0);
            const diferencia = Number((fisico - esperado).toFixed(2));
            const saldoFinal = Number((fisico - entregar).toFixed(2));
            const obs = document.getElementById('caja-obs').value.trim();

            if (entregar > fisico) return showToast("No podés entregar más de lo que hay contado en caja", "error");

            // HALLAZGO CIERRE: Permitir saldo_final = 0 si se retira todo, o diferencia = 0 (cuadratura perfecta)
            const permitirSinObs = (Math.abs(saldoFinal) < 0.01) || (Math.abs(diferencia) < 0.01);
            if (Math.abs(diferencia) >= 0.01 && !permitirSinObs && !obs) {
                const aviso = (typeof userRole !== 'undefined' && userRole === 'admin')
                    ? "Hay diferencia con lo esperado: escribí una observación o retira TODO el efectivo para que quede en Q0"
                    : "Antes de cerrar, escribí una observación de cómo estuvo el turno";
                return showToast(aviso, "error");
            }

            const btn = document.getElementById('btn-save-caja');
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
            btn.disabled = true;

            const ts = sysTime();
            // Extraer solo YYYY-MM de "YYYY-MM-DD HH:mm:ss" para mes_año
            const soloFecha = ts.split(' ')[0]; // "YYYY-MM-DD"
            const mesAnoPartes = soloFecha.split('-');
            const mes_ano = mesAnoPartes[0] + '-' + mesAnoPartes[1]; // "YYYY-MM" sin hora

            // HALLAZGO 9: Usar generador de ID único
            const payload = {
                id: generarIdUnico('CAJ-'),
                fecha_registro: ts,
                mes_año: mes_ano,
                efectivo_esperado: esperado,
                total_recaudado: fisico,
                base_caja_sencillo: sencillo,
                efectivo_entregado: entregar,
                diferencia: diferencia,
                saldo_final: saldoFinal,
                usuario: getActiveUserName(),
                observaciones: obs
            };

            try {
                const r = await apiCall('crud', { sheetName: 'Caja_Mensual', operation: 'create', rowData: payload, idField: 'id', idValue: payload.id });
                // apiCall devuelve null cuando la peticion quedo en la cola offline: el cierre igual vale.
                if (!r || r.status === 'success') {
                    if(!DB.Caja_Mensual) DB.Caja_Mensual = [];
                    DB.Caja_Mensual.push(payload);
                    logAudit('Finanzas', 'Cierre de Caja', `Esperado Q${esperado.toFixed(2)} / contado Q${fisico.toFixed(2)} / diferencia Q${diferencia.toFixed(2)} / entregado Q${entregar.toFixed(2)}`);
                    showToast(`✅ Cierre Guardado: Esperado Q${esperado.toFixed(2)} / Contado Q${fisico.toFixed(2)} / Queda Q${saldoFinal.toFixed(2)}`);
                    closeModal('modal-caja');
                    try {
                        renderFinanzas();
                    } catch (renderErr) {
                        console.error('Error al renderizar finanzas:', renderErr);
                        showToast('Cierre guardado pero hubo error al actualizar. Recarga la página.', 'error');
                    }
                } else {
                    showToast(r.message || "Error al procesar cierre", "error");
                }
            } catch (e) {
                console.error(e);
                showToast("Error de conexión", "error");
            } finally {
                btn.innerHTML = '<i class="fa-solid fa-lock mr-2"></i> Procesar Cierre';
                btn.disabled = false;
            }
        };

        // --- TICKETS Y TAREAS ---
        // Guarda una clave de Configuracion en la copia local (la nube va aparte)
        const setConfigLocal = (clave, valor) => {
            if (!DB.Configuracion) DB.Configuracion = [];
            const i = DB.Configuracion.findIndex(c => String(c.Clave).trim() === clave);
            if (i > -1) DB.Configuracion[i].Valor = valor;
            else DB.Configuracion.push({ Clave: clave, Valor: valor });
        };

        const saveConfig = window.saveConfig = async () => {
            if(!checkUserActive()) return;
            const nom = document.getElementById('cfg-nombre').value;
            if(!nom) return;

            setConfigLocal('StoreName', nom);
            applyConfig(); showToast("Ajustes globales guardados."); logAudit('AJUSTES', 'CONFIG GUARDADA', `Config guardada por Admin`);

            apiCall('updateConfig', { configData: { 'StoreName': nom } });
        };

        
        const logAudit = window.logAudit = async (modulo, accion, detalles) => {
            const l = { Timestamp: sysTime(), Usuario: getActiveUserName(), Modulo: modulo, Accion: accion, Detalles: detalles };
            if(!DB.Auditoria_Logs) DB.Auditoria_Logs = [];
            DB.Auditoria_Logs.push(l);
            apiCall('crud', { sheetName: 'Auditoria_Logs', operation: 'create', rowData: l, idField: 'Timestamp', idValue: l.Timestamp });
        };
        const logTime = window.logTime = async (action) => {
            const registro = {
                ID_Registro: 'AST-' + Date.now(),
                Usuario_Email: getActiveUserName(),
                Tipo_Accion: action,
                Timestamp: sysTime()
            };
            if(!DB.Asistencia_Usuarios) DB.Asistencia_Usuarios = [];
            DB.Asistencia_Usuarios.push(registro);
            showToast(`Registro: ${action.replace('_',' ')}`);
            apiCall('crud', { sheetName: 'Asistencia_Usuarios', operation: 'create', rowData: registro, idField: 'ID_Registro', idValue: registro.ID_Registro });
        };

        // AUTH FIREBASE
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            document.getElementById('btn-login').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
            document.getElementById('btn-login').disabled = true;
            signInWithEmailAndPassword(auth, document.getElementById('auth-email').value, document.getElementById('auth-password').value)
                .catch(err => {
                    document.getElementById('btn-login').innerText = 'Ingresar'; document.getElementById('btn-login').disabled = false;
                    document.getElementById('login-error').innerText = 'Password o user incorrecto';
                    document.getElementById('login-error').classList.remove('hidden');
                });
        });

        onAuthStateChanged(auth, async (user) => {
            // HALLAZGO 8: Eliminar bloque preview - no soportado en producción
            if (user) {
                const gLoader = document.getElementById('global-loader');
                if (gLoader) { gLoader.style.opacity = '1'; gLoader.style.display = 'flex'; }
                
                currentUser = user.email;
                document.getElementById('user-display').innerText = user.email.split('@')[0];
                document.getElementById('auth-view').classList.add('hidden-view'); 
                document.getElementById('app-view').classList.remove('hidden-view');
                
                try {
                    // 1. Obtener Rol de Firestore
                    const userDoc = await getDoc(doc(db, "farmacia_roles", user.email.toLowerCase()));
                    if (user.email.toLowerCase() === 'fernan151085@gmail.com') {
                        userRole = 'admin'; // Hardcode primary admin fallback
                    } else if (userDoc.exists()) {
                        userRole = userDoc.data().role || userDoc.data().rol || 'user';
                    } else {
                        userRole = 'user';
                    }

                    // 2. Aplicar Restricciones de UI
                    if (userRole === 'user') {
                        document.body.classList.add('role-user');
                        // Ocultar tabs de admin
                        // Hidden by CSS class 'admin-only' on the links
                        document.getElementById('user-display').innerHTML += ' <span class="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded ml-2">Cajero</span>';
                    } else {
                        document.body.classList.remove('role-user');
                        document.getElementById('user-display').innerHTML += ' <span class="bg-red-100 text-red-800 text-[10px] px-2 py-0.5 rounded ml-2">Admin</span>';
                    }

                    // 3. Cargar Datos y setear fechas Finanzas por defecto
                    const t = new Date();
                    document.getElementById('fin-date-end').value = '';
                    t.setDate(t.getDate() - 7);
                    document.getElementById('fin-date-start').value = t.toISOString().split('T')[0];
                    
                    await syncData();
                    logTime('Conexión_Global'); 
                    
                    // 4. Redirigir a vista inicial
                    if (userRole === 'user') {
                        document.body.classList.add('role-user');
                        document.querySelector('[data-target="tab-pos"]').click();
                    } else {
                        document.querySelector('[data-target="tab-dash"]').click();
                    }
                } catch(e) {
                    console.error(e);
                    showToast("Error al inicializar el sistema. Verifica roles.", "error");
                }
            } else {
                document.getElementById('app-view').classList.add('hidden-view'); 
                document.getElementById('auth-view').classList.remove('hidden-view');
                document.getElementById('btn-login').innerText = 'Ingresar'; 
                document.getElementById('btn-login').disabled = false;
                const gLoader = document.getElementById('global-loader');
                if (gLoader) gLoader.style.display = 'none';
            }
        });

        window.toggleSidebar = () => {
            const sb = document.getElementById('sidebar');
            const ov = document.getElementById('sidebar-overlay');
            if(window.innerWidth < 768) {
                if(sb) sb.classList.toggle('-translate-x-full');
                if(ov) ov.classList.toggle('hidden');
            } else {
                if(sb) sb.classList.toggle('md:-ml-64');
            }
        };

        const handleLogout = window.handleLogout = () => { logTime('Desconexión_Global').then(() => signOut(auth)); };

        // TAB SWITCHER
        document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden-view'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-primary','text-gray-300') || b.classList.remove('bg-accent'));
            document.getElementById(e.currentTarget.dataset.target).classList.remove('hidden-view');
            e.currentTarget.classList.add('bg-accent'); e.currentTarget.classList.replace('text-gray-300','text-primary');
            document.getElementById('top-title').innerText = e.currentTarget.innerText;
            
            if(window.innerWidth < 768 && window.toggleSidebar) {
                const sb = document.getElementById('sidebar');
                if(sb && !sb.classList.contains('-translate-x-full')) toggleSidebar();
            }

            try {
                if(e.currentTarget.dataset.target === 'tab-dash') renderDashboard();
                if(e.currentTarget.dataset.target === 'tab-audit') renderAudit();
                if(e.currentTarget.dataset.target === 'tab-clientes') renderClientes();
                if(e.currentTarget.dataset.target === 'tab-fin') renderFinanzas();
                if(e.currentTarget.dataset.target === 'tab-inv') renderInventario();
                if(e.currentTarget.dataset.target === 'tab-hr') renderTickets();
            } catch(ex) {
                console.error("Error al cambiar de tab", ex);
            }
        }));

        window.addEventListener('message', async (e) => {
            if(e.data && e.data.action === 'export') {
                if(!window.html2canvas) {
                    const script = document.createElement('script');
                    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
                    document.head.appendChild(script);
                    await new Promise(r => script.onload = r);
                }
                try {
                    const canvas = await html2canvas(document.body, { backgroundColor: '#f8fafc', useCORS: true });
                    const link = document.createElement('a');
                    link.download = e.data.title + '.jpg';
                    link.href = canvas.toDataURL('image/jpeg', 0.9);
                    link.click();
                    e.source.postMessage({ action: 'export_done' }, '*');
                } catch(err) {
                    console.error("Error al exportar:", err);
                    e.source.postMessage({ action: 'export_error' }, '*');
                }
            }
        });
    