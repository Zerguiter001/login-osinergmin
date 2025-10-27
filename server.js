/**
 * ============================================
 *  SERVICIO OSINERGMIN - SCOP GLP (Puppeteer)
 *  - TODO el scraping está encapsulado en UNA sola función: realizarScraping(...)
 *  - Incluye comentarios "PASO 1, PASO 2, ..." de lo que hace el scraping
 *  - No se modifica la lógica original (solo organización y comentarios)
 * ============================================
 */

require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const qs = require('qs');
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------
 *  CARGA DE CONFIGURACIÓN EXTERNA (pass.json en la raíz del proyecto)
 * ------------------------------------------------------------------ */
const passConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'pass.json'), 'utf8')
);

/* ------------------------------------------------------------------
 *  CONFIGURACIÓN DE LOGS
 * ------------------------------------------------------------------ */
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = (...args) => {
  fs.appendFileSync(
    'logs.txt',
    `${new Date().toISOString()} - ${args.join(' ')}\n`,
    'utf8'
  );
};
console.error = (...args) => {
  fs.appendFileSync(
    'logs.txt',
    `${new Date().toISOString()} - ERROR: ${args.join(' ')}\n`,
    'utf8'
  );
};

const port = process.env.PORT || 3000;
originalConsoleLog(`🚀 SERVER PRENDIDO EN EL PUERTO ${port}`);

/* ------------------------------------------------------------------
 *  EXPRESS APP
 * ------------------------------------------------------------------ */
const app = express();
app.use(express.json());

/* ------------------------------------------------------------------
 *  POOL DE PESTAÑAS (TABS) Y COLA (QUEUE)
 * ------------------------------------------------------------------ */
const MAX_TABS = 20; // Límite de pestañas abiertas en paralelo
let browser = null;
const tabPool = [];
const tabQueue = [];
let initializing = false;

/* ------------------------------------------------------------------
 *  CONSTANTES/FLAGS DE DETALLE
 * ------------------------------------------------------------------ */
const OSINERG_BASE = 'https://pvo.osinergmin.gob.pe';
const DETALLE_ENDPOINT = `${OSINERG_BASE}/scopglp3/servlet/com.osinerg.scopglp.servlets.ConsultaOrdenPedidoServlet`;
const MAX_DETALLES = Number.parseInt(process.env.MAX_DETALLES || '999999', 10);
const SHOW_FULL_DETAILS = process.env.SHOW_FULL_DETAILS === 'true';
const SAVE_SCREENSHOTS = process.env.SAVE_SCREENSHOTS === 'true';

/* ------------------------------------------------------------------
 *  UTILIDADES DE ARCHIVOS
 * ------------------------------------------------------------------ */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}
function tsFolder() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
    now.getSeconds()
  )}`;
  const out = path.join(process.cwd(), 'detalles', stamp);
  ensureDir(out);
  return out;
}

/* ------------------------------------------------------------------
 *  FECHAS
 * ------------------------------------------------------------------ */
function getCurrentDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
}
function isValidDateFormat(dateStr) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr);
}

/* ------------------------------------------------------------------
 *  INICIALIZACIÓN DEL NAVEGADOR
 * ------------------------------------------------------------------ */
async function initializeBrowser() {
  if (initializing) return;
  initializing = true;
  try {
    console.log('Inicializando navegador...');

    // 🔹 NUEVO: control por .env para ver el navegador en vivo sin cambiar tu lógica
    const showBrowser = process.env.SHOW_BROWSER === '1';
    const devtools = process.env.DEVTOOLS === '1';
    const slowMo = Number.parseInt(process.env.SLOWMO || '0', 10);
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    const launchOpts = {
      headless: showBrowser ? false : 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      slowMo: showBrowser ? slowMo : 0,
      devtools: showBrowser ? devtools : false,
    };
    if (execPath) launchOpts.executablePath = execPath;

    browser = await puppeteer.launch(launchOpts);
    console.log('Navegador inicializado correctamente');
  } catch (err) {
    console.error('Error al inicializar el navegador:', err.message);
    if (browser) {
      await browser.close();
      browser = null;
    }
    throw err;
  } finally {
    initializing = false;
  }
}

/* ------------------------------------------------------------------
 *  AUTENTICACIÓN Y CREACIÓN DE PESTAÑA
 * ------------------------------------------------------------------ */
async function createAuthenticatedTab(credentials) {
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    if (process.env.SAVE_LIGHT === '1') {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const t = req.resourceType();
        if (['image', 'font', 'stylesheet'].includes(t)) req.abort();
        else req.continue();
      });
    }

    console.log(`Autenticando nueva pestaña con usuario ${credentials.OSINERGMIN_USERNAME}...`);
    await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    await page.waitForSelector('input[name="j_username"]', { timeout: 8000 });

    if (!credentials.OSINERGMIN_USERNAME || !credentials.OSINERGMIN_PASSWORD) {
      throw new Error('Credenciales no definidas para el local proporcionado');
    }
    await page.type('input[name="j_username"]', credentials.OSINERGMIN_USERNAME);
    await page.type('input[name="j_password"]', credentials.OSINERGMIN_PASSWORD);

    // Intento no bloqueante de reCAPTCHA
    let recaptchaToken = null;
    try {
      recaptchaToken = await page.evaluate(() => {
        return new Promise((resolve) => {
          try {
            grecaptcha.ready(() => {
              grecaptcha
                .execute('6LeAU68UAAAAACp0Ci8TvE5lTITDDRQcqnp4lHuD', { action: 'login' })
                .then((token) => resolve(token))
                .catch(() => resolve(null));
            });
          } catch {
            resolve(null);
          }
        });
      });
      console.log(`Token reCAPTCHA:`, recaptchaToken || 'No se obtuvo token');
    } catch (err) {
      console.log(`Error al obtener token reCAPTCHA:`, err.message);
    }

    if (recaptchaToken) {
      await page.evaluate((token) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'g-recaptcha-response';
        input.value = token;
        document.querySelector('form').appendChild(input);
      }, recaptchaToken);
    }

    await Promise.all([
      page.click('button[type="submit"]'),
      page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 })
        .catch(() => console.log('Navegación post-login no completada, continuando...')),
    ]);

    if (page.url().includes('login?error=UP')) {
      throw new Error('Fallo en el login: credenciales inválidas o reCAPTCHA');
    }

    await page.waitForFunction('typeof muestraPagina === "function"', { timeout: 8000 });
    await page.evaluate(() => muestraPagina('163', 'NO', 'NO'));
    await new Promise((r) => setTimeout(r, 500));

    return { page, inUse: false };
  } catch (err) {
    console.error('Error al crear y autenticar pestaña:', err.message);
    if (page) await page.close();
    throw err;
  }
}

/* ------------------------------------------------------------------
 *  ⭐ FUNCIÓN ÚNICA DE SCRAPING ⭐
 *  - TODO el flujo de scraping (listado + detalles) con "PASO 1, 2, ..."
 * ------------------------------------------------------------------ */
async function realizarScraping(page, { codigo_autorizacion, txt_fecini, txt_fecfin }) {
  console.log("ENTRA AQUI")
  /* PASO 0: Preparación (listeners + utilidades + constantes de salida) */
  page.on('request', (request) => {
    console.log(`Solicitud: ${request.method()} ${request.url()}`);
  });
  page.on('response', async (response) => {
    console.log(`Respuesta: ${response.url()} - Status: ${response.status()}`);
    if (!response.ok()) {
      const text = await response.text().catch(() => 'No se pudo leer el cuerpo de la respuesta');
      console.log(`Respuesta fallida: ${text}`);
    }
  });
  const outDir = tsFolder();

  /* Utilidad interna (misma lógica de antes) para parsear el DETALLE */
  async function obtenerYGuardarDetalle(page, codigoAutorizacion, refererUrl) {
    // PASO 5.1: Construir URL de detalle y navegar
    const url = `${DETALLE_ENDPOINT}?codigoAutorizacion=${encodeURIComponent(codigoAutorizacion)}&opc=2`;
    const startTime = Date.now();
    try {
      console.log(`Abriendo detalle ${codigoAutorizacion}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // PASO 5.2: (Opcional) Capturar HTML/PNG
      const base = path.join(outDir, `detalle_${codigoAutorizacion}`);
      const htmlPath = `${base}.html`;
      const pngPath = `${base}.png`;
      const html = await page.content();
      // fs.writeFileSync(htmlPath, html, 'utf8'); // opcional
      if (SAVE_SCREENSHOTS) {
        await page.screenshot({ path: pngPath, fullPage: true });
      }

      // PASO 5.3: Parsear el DOM del detalle en el navegador
      const detalle = await page.evaluate(() => {
        const norm = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const limpiarParentesis = (texto) => texto.replace(/[()]/g, '').toUpperCase();
        const out = {
          cabeceraTitulo: '',
          agenteVendedor: '',
          tipoVendedor: '',
          codigoAutorizacion: '',
          codigoReferencia: '',
          estado: '',
          fechaPedido: '',
          tipoPedido: '',
          numeroFactura: '',
          fechaEmisionFactura: '',
          numeroGuiaRemision: '',
          agenteComprador: '',
          camion: { placa: '', capacidadKg: '', un: '' },
          productos: [],
          totales: {},
        };

        // Cabecera
        const tblFiltros = document.querySelector('table.TblFiltros');
        if (tblFiltros) {
          const filas = Array.from(tblFiltros.querySelectorAll('tr.Fila'));
          const celda3 = tblFiltros.querySelector('.Celda3');
          if (celda3) out.cabeceraTitulo = norm(celda3.textContent);

          filas.forEach((tr) => {
            const tds = Array.from(tr.querySelectorAll('.Celda2'));
            if (tds.length === 2) {
              const label = norm(tds[0].textContent).toLowerCase();
              const value = norm(tds[1].textContent);
              if (label.includes('agente vendedor')) out.agenteVendedor = value;
              else if (label.includes('tipo vendedor')) out.tipoVendedor = value;
              else if (label.includes('código autorización')) out.codigoAutorizacion = value;
              else if (label.includes('código referencia')) out.codigoReferencia = value === '&' ? '' : value;
              else if (label === 'estado') out.estado = value;
              else if (label.includes('fecha pedido')) out.fechaPedido = value;
              else if (label.includes('tipo de pedido')) out.tipoPedido = value;
              else if (label.includes('número factura')) out.numeroFactura = value;
              else if (label.includes('fecha emisión de factura')) out.fechaEmisionFactura = value;
              else if (label.includes('número guia de remisión') || label.includes('número guía de remisión')) out.numeroGuiaRemision = value;
              else if (label.includes('agente comprador')) out.agenteComprador = value;
            }
          });
        }

        // Camión
        const allTables = Array.from(document.querySelectorAll('table'));
        const camionTable = allTables.find((tb) => tb.textContent && tb.textContent.includes('Placa del Camión'));
        if (camionTable) {
          const tds = Array.from(camionTable.querySelectorAll('td.Celda2'));
          if (tds.length >= 4) {
            let weigth = norm(tds[3].innerText);
            out.camion.placa = norm(tds[1].innerText || tds[1].textContent);
            out.camion.capacidadKg = norm(weigth.split(' ')[0] || tds[3].textContent.split(' ')[0]);
            out.camion.un = limpiarParentesis(weigth.split(' ')[1]) || '';
          } else {
            const tr = camionTable.querySelector('tr.Fila');
            if (tr) {
              const c = Array.from(tr.querySelectorAll('td.Celda2')).map((x) => norm(x.innerText || x.textContent));
              if (c.length >= 4) {
                out.camion.placa = c[1] || '';
                out.camion.capacidadKg = c[3].split(' ')[0] || '';
                out.camion.un = limpiarParentesis(c[3].split(' ')[1]) || '';
              }
            }
          }
        }

        // Productos
        const prodTable = Array.from(document.querySelectorAll('table.TblResultado')).find((tb) => {
          const headerRow = tb.querySelector('tr.Fila');
          if (!headerRow) return false;
          const headers = Array.from(headerRow.querySelectorAll('td.Celda, th.Celda')).map((h) =>
            norm(h.textContent).toLowerCase()
          );
          return headers.includes('producto') && headers.includes('marca');
        });

        if (prodTable) {
          const rows = Array.from(prodTable.querySelectorAll('tr.Fila'));
          if (rows.length) {
            const dataRows = rows.slice(1);
            dataRows.forEach((tr) => {
              const cells = Array.from(tr.querySelectorAll('td.Celda1, td.Celda'));
              const texts = cells.map((c) => norm(c.innerText || c.textContent));
              if (!texts.length) return;

              const joined = texts.join(' ').toLowerCase();
              const isTotal = joined.includes('total') && texts.length >= 4;

              if (isTotal) {
                const nums = texts.filter((t) => t && t !== '&' && t !== 'TOTAL' && !isNaN(Number(t)));
                if (nums.length) {
                  const last = nums[nums.length - 1];
                  const prev = nums[nums.length - 2] || '';
                  out.totales = { cantidadPedida: prev, subtotalKg: last };
                }
              } else {
                const prod = {
                  producto: texts[0] || '',
                  marca: texts[1] || '',
                  cantidadPedida: texts[2] || '',
                  cantidadAceptada: texts[3] || '',
                  cantidadVendida: texts[4] || '',
                  cantidadRecibida: texts[5] || '',
                  subtotalKg: texts[6] || '',
                  estado: texts[7] || '',
                };
                const hasAny = Object.values(prod).some((v) => v);
                if (hasAny) out.productos.push(prod);
              }
            });
          }
        }

        return out;
      });

      console.log(`Detalle ${codigoAutorizacion} procesado en ${Date.now() - startTime} ms`);
      return { url, htmlPath, pngPath, detalle };
    } catch (e) {
      console.error(`Error procesando detalle ${codigoAutorizacion}:`, e.message);
      return { url, error: e.message };
    }
  }

  /* PASO 1: Construir payload del formulario (POST) */
  console.log('Enviando formulario POST...');
  const payload = qs.stringify({
    ind: '',
    opc: '1',
    codvendope: '',
    codigoAgente: '',
    tipoUsuario: 'C',
    codigo_referencia: '',
    codigo_autorizacion,
    tipoOperacion: '',
    tipoAgente: '',
    nombreAgente: '',
    tipoDocumento: '',
    numeroDocumento: '',
    estadoOrdenPedido: '',
    canalOrdenPedido: '',
    tipoOrdenPedido: '',
    txt_placa: '',
    tipoFecha: '',
    txt_fecini,
    txt_fecfin,
  });

  /* PASO 2: Ir a la página de consulta */
  await page.goto(
    'https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp',
    { waitUntil: 'domcontentloaded', timeout: 10000 }
  );

  /* PASO 3: Inyectar y enviar el formulario con método POST */
  await page.evaluate((payload) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/scopglp3/servlet/com.osinerg.scopglp.servlets.ConsultaOrdenPedidoServlet';
    for (const [key, value] of new URLSearchParams(payload)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }, payload);

  /* PASO 4: Esperar la navegación + disponibilidad de la tabla de resultados */
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log('Esperando tabla de resultados...');
  await page.waitForSelector('table.TblResultado', { timeout: 8000 }).catch(() => {
    console.log('No se encontró la tabla TblResultado');
  });

  /* PASO 5: Parsear el listado de resultados (cabeceras) */
  const results = await page.evaluate(() => {
    const table = document.querySelector('table.TblResultado');
    if (!table) return { error: 'No se encontró la tabla TblResultado' };

    const rows = Array.from(table.querySelectorAll('tr.Fila'));
    if (rows.length === 0) return { error: 'No se encontraron filas con datos en la tabla' };

    const validResults = [];
    const errors = [];

    rows.forEach((row, index) => {
      const cells = row.querySelectorAll('td.Celda1');
      if (cells.length < 9) {
        errors.push(`Fila ${index + 1}: Número insuficiente de celdas (${cells.length})`);
        return;
      }
      validResults.push({
        codigoAutorizacion: cells[0]?.innerText.trim() || '',
        codigoReferencia: cells[1]?.innerText.trim() || '',
        comprador: cells[2]?.innerText.trim() || '',
        vendedor: cells[3]?.innerText.trim() || '',
        tipoPedido: cells[4]?.innerText.trim() || '',
        canal: cells[5]?.innerText.trim() || '',
        fechaPedido: cells[6]?.innerText.trim() || '',
        fechaEntrega: cells[7]?.innerText.trim() || '',
        estado: cells[8]?.innerText.trim() || '',
      });
    });

    if (errors.length > 0) console.log('Errores en filas:', errors);
    if (validResults.length === 0) return { error: 'No se encontraron filas válidas' };
    return validResults;
  });

  /* PASO 6: Si no hay filas válidas, devolver mensaje */
  if (results.error) {
    return { filteredResults: [], message: results.error };
  }

  /* PASO 7: Para cada fila, si aplica, abrir y parsear DETALLE; luego volver al listado */
  const referer = page.url();
  const limite = Math.min(results.length, MAX_DETALLES);

  for (let i = 0; i < limite; i++) {
    const r = results[i];
    if (!r.codigoAutorizacion) {
      r.detalle = { error: 'Sin codigoAutorizacion' };
      continue;
    }
    if (r.estado === 'SOLICITADO' || SHOW_FULL_DETAILS) {
      const det = await obtenerYGuardarDetalle(page, r.codigoAutorizacion, referer);
      if (det.detalle) r.detalle = det.detalle;
      else r.detalle = { error: det.error || 'No se pudo parsear detalle' };

      // PASO 5.4: Volver al referer (listado) para continuar con la siguiente fila
      await page.goto(referer, { waitUntil: 'domcontentloaded', timeout: 10000 });
    }
  }

  /* PASO 8: Filtrar la salida según SHOW_FULL_DETAILS */
  const filteredResults = results.map((result) => {
    if (result.estado === 'SOLICITADO' || SHOW_FULL_DETAILS) {
      return result;
    } else {
      const { detalle, ...cabecera } = result;
      return cabecera;
    }
  });

  /* PASO 9: Devolver los resultados */
  console.log('Resultados obtenidos:', filteredResults);
  return { filteredResults };
}

/* ------------------------------------------------------------------
 *  GESTIÓN DE POOL / COLA
 * ------------------------------------------------------------------ */
async function getAvailableTab(credentials) {
  let tabObj = tabPool.find((t) => !t.inUse);
  if (tabObj) {
    tabObj.inUse = true;
    console.log('Pestaña disponible asignada del pool');
    return tabObj;
  }

  if (tabPool.length < MAX_TABS) {
    console.log('Creando nueva pestaña...');
    tabObj = await createAuthenticatedTab(credentials);
    tabPool.push(tabObj);
    tabObj.inUse = true;
    console.log(`Nueva pestaña creada, total: ${tabPool.length}`);
    return tabObj;
  }

  console.log('Límite de pestañas alcanzado, encolando solicitud...');
  return new Promise((resolve) => {
    tabQueue.push({ credentials, resolve });
    checkQueue();
  });
}

async function releaseTab(tabObj) {
  // 1 request = 1 pestaña: se cierra y se remueve del pool
  if (tabObj && tabObj.page) {
    try {
      await tabObj.page.close();
      console.log('Pestaña cerrada');
    } catch (err) {
      console.error('Error al cerrar pestaña:', err.message);
    }
    const index = tabPool.indexOf(tabObj);
    if (index !== -1) {
      tabPool.splice(index, 1);
      console.log(`Pestaña removida del pool, total: ${tabPool.length}`);
    }
    checkQueue();
  }
}

async function checkQueue() {
  if (tabQueue.length === 0 || tabPool.length >= MAX_TABS) return;
  const { credentials, resolve } = tabQueue.shift();
  try {
    const tabObj = await createAuthenticatedTab(credentials);
    tabPool.push(tabObj);
    tabObj.inUse = true;
    console.log(`Pestaña creada desde la cola, total: ${tabPool.length}`);
    resolve(tabObj);
  } catch (err) {
    console.error('Error al procesar cola:', err.message);
    checkQueue(); // intenta siguiente
  }
}

/* ------------------------------------------------------------------
 *  ENDPOINT HTTP
 * ------------------------------------------------------------------ */
app.post('/api/osigermin-Scoop', async (req, res) => {
  const startTime = Date.now();
  console.log('Inicio de solicitud:', new Date().toISOString());
  fs.writeFileSync('logs.txt', '', 'utf8'); // limpia archivo de logs

  const { codigo_autorizacion, U_RS_Local } = req.body;
  const txt_fecini = process.env.START_DATE;
  const txt_fecfin = getCurrentDate();

  if (!codigo_autorizacion) {
    console.log = originalConsoleLog;
    return res.status(400).json({ error: 'Falta parámetro requerido: codigo_autorizacion' });
  }
  if (!U_RS_Local) {
    console.log = originalConsoleLog;
    return res.status(400).json({ error: 'Falta parámetro requerido: U_RS_Local' });
  }
  if (!txt_fecini || !isValidDateFormat(txt_fecini)) {
    console.log = originalConsoleLog;
    return res
      .status(400)
      .json({ error: 'START_DATE no definida en .env o formato inválido (debe ser DD/MM/YYYY)' });
  }

  const localKey = String(U_RS_Local).padStart(3, '0');
  const credentials = passConfig.locales[localKey];
  if (!credentials) {
    console.log = originalConsoleLog;
    return res
      .status(400)
      .json({ error: `No se encontraron credenciales para U_RS_Local: ${U_RS_Local}` });
  }

  if (!browser) {
    try {
      await initializeBrowser();
    } catch (err) {
      console.log = originalConsoleLog;
      return res.status(500).json({ error: `Error al inicializar el navegador: ${err.message}` });
    }
  }

  let tabObj;
  try {
    tabObj = await getAvailableTab(credentials);
    const page = tabObj.page;

    const { filteredResults, message } = await realizarScraping(page, {
      codigo_autorizacion,
      txt_fecini,
      txt_fecfin,
    });

    console.log = originalConsoleLog;
    if (message) {
      console.log('✅ 3. RESULTADOS OBTENIDOS EXITOSAMENTE (sin datos)');
      console.log(`Fin de solicitud: ${Date.now() - startTime} ms`);
      return res.status(200).json({ results: [], message });
    } else {
      console.log('✅ 3. RESULTADOS OBTENIDOS EXITOSAMENTE');
      console.log(`Fin de solicitud: ${Date.now() - startTime} ms`);
      return res.status(200).json({ results: filteredResults });
    }
  } catch (err) {
    console.error('Error en la solicitud:', err.message);
    console.log = originalConsoleLog;
    console.log(`Fin de solicitud con error: ${Date.now() - startTime} ms`);
    return res.status(500).json({ error: `Error en la solicitud: ${err.message}` });
  } finally {
    if (tabObj) {
      await releaseTab(tabObj);
    }
  }
});

/* ------------------------------------------------------------------
 *  ⭐ FUNCIÓN PRINCIPAL ⭐
 * ------------------------------------------------------------------ */
async function main() {
  try {
    const server = app.listen(port, () => {
      console.log(`🚀 Servidor corriendo en el puerto ${port}`);
    });
    server.keepAliveTimeout = 120000; // 2 minutos
    server.headersTimeout = 130000;   // 2 minutos + margen
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
    console.log = originalConsoleLog;
    process.exit(1);
  }
}

/* ------------------------------------------------------------------
 *  INICIO
 * ------------------------------------------------------------------ */
main();

/* ------------------------------------------------------------------
 *  MANEJO DE SEÑALES
 * ------------------------------------------------------------------ */
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
  console.log = originalConsoleLog;
  console.log('🛑 SERVER CERRADO');
  process.exit();
});

process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
  console.log = originalConsoleLog;
  console.log('🛑 SERVER CERRADO');
  process.exit();
});
