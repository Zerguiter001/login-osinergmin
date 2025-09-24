require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const qs = require('qs');
const fs = require('fs');
const path = require('path');

// Redefinir console.log desde el inicio para capturar todos los mensajes
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = (...args) => {
  fs.appendFileSync('logs.txt', `${new Date().toISOString()} - ${args.join(' ')}\n`, 'utf8');
};
console.error = (...args) => {
  fs.appendFileSync('logs.txt', `${new Date().toISOString()} - ERROR: ${args.join(' ')}\n`, 'utf8');
};

// Mostrar mensaje inicial en pantalla con el puerto
const port = process.env.PORT || 3000;
originalConsoleLog(`🚀 SERVER PRENDIDO EN EL PUERTO ${port}`);

// Definir browser en el ámbito global
let browser = null;
// Variable para rastrear la primera consulta
let isFirstRequest = true;

const app = express();
app.use(express.json());

// Función para escribir logs en el archivo
const writeLogToFile = (message) => {
  fs.appendFileSync('logs.txt', `${new Date().toISOString()} - ${message}\n`, 'utf8');
};

// Función para formatear la fecha actual como DD/MM/YYYY
function getCurrentDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
}

// Validar formato de fecha DD/MM/YYYY
function isValidDateFormat(dateStr) {
  const regex = /^\d{2}\/\d{2}\/\d{4}$/;
  return regex.test(dateStr);
}

// ===== Config extra para DETALLE =====
const OSINERG_BASE = 'https://pvo.osinergmin.gob.pe';
const DETALLE_ENDPOINT = `${OSINERG_BASE}/scopglp3/servlet/com.osinerg.scopglp.servlets.ConsultaOrdenPedidoServlet`;
const MAX_DETALLES = Number.parseInt(process.env.MAX_DETALLES || '999999', 10);
const SHOW_FULL_DETAILS = process.env.SHOW_FULL_DETAILS === 'true';
const SAVE_SCREENSHOTS = process.env.SAVE_SCREENSHOTS === 'true';

// Utilidades para guardar archivos
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}
function tsFolder() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const out = path.join(process.cwd(), 'detalles', stamp);
  ensureDir(out);
  return out;
}

// Inicializar el navegador al arrancar la aplicación
async function initializeBrowser() {
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    console.log('🌐 Navegador iniciado');
  } catch (err) {
    console.error('Error iniciando el navegador:', err.message);
    process.exit(1);
  }
}

// Llamar a la inicialización del navegador al iniciar la aplicación
initializeBrowser();

// Abrir detalle (opc=2), guardar HTML+PNG y extraer JSON
async function obtenerYGuardarDetalle(page, codigoAutorizacion, refererUrl, outDir) {
  const url = `${DETALLE_ENDPOINT}?codigoAutorizacion=${encodeURIComponent(codigoAutorizacion)}&opc=2`;
  const startTime = Date.now();
  try {
    console.log(`Abriendo detalle ${codigoAutorizacion}: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const base = path.join(outDir, `detalle_${codigoAutorizacion}`);
    const htmlPath = `${base}.html`;
    const pngPath = `${base}.png`;
    const html = await page.content();
    // fs.writeFileSync(htmlPath, html, 'utf8');
    if (SAVE_SCREENSHOTS) {
      await page.screenshot({ path: pngPath, fullPage: true });
    }

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
        totales: {}
      };

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

      const prodTable = Array.from(document.querySelectorAll('table.TblResultado')).find((tb) => {
        const headerRow = tb.querySelector('tr.Fila');
        if (!headerRow) return false;
        const headers = Array.from(headerRow.querySelectorAll('td.Celda, th.Celda')).map((h) => norm(h.textContent).toLowerCase());
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
                out.totales = { cantidadRecibida: prev, subtotalKg: last };
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
                estado: texts[7] || ''
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

app.post('/api/scrape', async (req, res) => {
  const startTime = Date.now();
  console.log('Inicio de solicitud:', new Date().toISOString());
  fs.writeFileSync('logs.txt', '', 'utf8');

  const { codigo_autorizacion } = req.body;
  const txt_fecini = process.env.START_DATE;
  const txt_fecfin = getCurrentDate();

  // Validar parámetros
  if (!codigo_autorizacion) {
    console.log = originalConsoleLog;
    return res.status(400).json({ error: 'Falta parámetro requerido: codigo_autorizacion' });
  }
  if (!txt_fecini || !isValidDateFormat(txt_fecini)) {
    console.log = originalConsoleLog;
    return res.status(400).json({ error: 'START_DATE no definida en .env o formato inválido (debe ser DD/MM/YYYY)' });
  }

  if (!browser) {
    console.log = originalConsoleLog;
    return res.status(500).json({ error: 'Navegador no inicializado' });
  }

  // Establecer reintentos: 3 para la primera consulta, 2 para las siguientes
  let retries = isFirstRequest ? 3 : 2;
  let attempt = 1;
  let page = null;

  while (attempt <= retries) {
    console.log(`Intento ${attempt} de ${retries}...`);
    try {
      page = await browser.newPage();
      const context = page.browserContext();

      page.on('request', request => {
        console.log(`Solicitud: ${request.method()} ${request.url()}`);
      });
      page.on('response', async response => {
        console.log(`Respuesta: ${response.url()} - Status: ${response.status()}`);
        if (!response.ok()) {
          const text = await response.text().catch(() => 'No se pudo leer el cuerpo de la respuesta');
          console.log(`Respuesta fallida: ${text}`);
        }
      });

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      if (process.env.SAVE_LIGHT === '1') {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const t = req.resourceType();
          if (['image', 'font', 'stylesheet'].includes(t)) req.abort();
          else req.continue();
        });
      }

      console.log('Accediendo a login...');
      await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
      console.log = originalConsoleLog;
      console.log('🌐 1. SE INGRESÓ A LA PÁGINA');
      console.log = (...args) => writeLogToFile(args.join(' '));

      await page.waitForSelector('input[name="j_username"]', { timeout: 8000 });
      console.log('Formulario de login cargado');

      console.log('Credenciales:', process.env.OSINERGMIN_USERNAME, process.env.OSINERGMIN_PASSWORD);
      if (!process.env.OSINERGMIN_USERNAME || !process.env.OSINERGMIN_PASSWORD) {
        throw new Error('Credenciales no definidas en el archivo .env');
      }
      await page.type('input[name="j_username"]', process.env.OSINERGMIN_USERNAME);
      await page.type('input[name="j_password"]', process.env.OSINERGMIN_PASSWORD);

      let recaptchaToken = null;
      try {
        recaptchaToken = await page.evaluate(() => {
          return new Promise((resolve) => {
            try {
              grecaptcha.ready(() => {
                grecaptcha.execute('6LeAU68UAAAAACp0Ci8TvE5lTITDDRQcqnp4lHuD', { action: 'login' })
                  .then(token => resolve(token))
                  .catch(() => resolve(null));
              });
            } catch {
              resolve(null);
            }
          });
        });
        console.log('Token reCAPTCHA:', recaptchaToken || 'No se obtuvo token');
      } catch (err) {
        console.log('Error al obtener token reCAPTCHA:', err.message);
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
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {
          console.log('Navegación después del login no completada, continuando...');
        }),
      ]);
      console.log('Login enviado');
      console.log(`URL después del login: ${page.url()}`);

      if (page.url().includes('login?error=UP')) {
        throw new Error('Fallo en el login: credenciales inválidas o problema con reCAPTCHA');
      }

      console.log('Activando módulo de consulta...');
      await page.waitForFunction('typeof muestraPagina === "function"', { timeout: 8000 });
      await page.evaluate(() => muestraPagina('163', 'NO', 'NO'));
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log = originalConsoleLog;
      console.log('📄 2. SE INGRESÓ AL CONTENIDO DE LA PÁGINA');
      console.log = (...args) => writeLogToFile(args.join(' '));

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
        txt_fecfin
      });

      await page.goto('https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp', { waitUntil: 'domcontentloaded', timeout: 10000 });

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

      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });

      console.log('Esperando tabla de resultados...');
      await page.waitForSelector('table.TblResultado', { timeout: 8000 }).catch(() => {
        console.log('No se encontró la tabla TblResultado');
      });

      const results = await page.evaluate(() => {
        const table = document.querySelector('table.TblResultado');
        if (!table) {
          return { error: 'No se encontró la tabla TblResultado' };
        }
        const rows = Array.from(table.querySelectorAll('tr.Fila'));
        if (rows.length === 0) {
          return { error: 'No se encontraron filas con datos en la tabla' };
        }
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
            estado: cells[8]?.innerText.trim() || ''
          });
        });
        if (errors.length > 0) {
          console.log('Errores en filas:', errors);
        }
        if (validResults.length === 0) {
          return { error: 'No se encontraron filas válidas con 9 celdas' };
        }
        return validResults;
      });

      const pageContent = await page.content();
      console.log('Contenido de la página:', pageContent.substring(0, 500), '...');

      if (results.error) {
        console.log = originalConsoleLog;
        await page.close();
        isFirstRequest = false; // Marcar que la primera consulta ya se realizó
        return res.status(200).json({ results: [], message: results.error });
      }

      const outDir = tsFolder();
      const referer = page.url();
      const limite = Math.min(results.length, MAX_DETALLES);

      // Abrir una nueva página para detalles
      const detailPage = await context.newPage();
      try {
        if (process.env.SAVE_LIGHT === '1') {
          await detailPage.setRequestInterception(true);
          detailPage.on('request', (req) => {
            const t = req.resourceType();
            if (['image', 'font', 'stylesheet'].includes(t)) req.abort();
            else req.continue();
          });
        }

        for (let i = 0; i < limite; i++) {
          const r = results[i];
          if (!r.codigoAutorizacion) {
            r.detalle = { error: 'Sin codigoAutorizacion' };
            continue;
          }
          if (r.estado === 'SOLICITADO' || SHOW_FULL_DETAILS) {
            const det = await obtenerYGuardarDetalle(detailPage, r.codigoAutorizacion, referer, outDir);
            if (det.detalle) r.detalle = det.detalle;
            else r.detalle = { error: det.error || 'No se pudo parsear detalle' };
            // Regresar a la página de consulta después de cada detalle
            await detailPage.goto(referer, { waitUntil: 'domcontentloaded', timeout: 10000 });
          }
        }
      } finally {
        await detailPage.close(); // Cerrar la página de detalles
      }

      const filteredResults = results.map(result => {
        if (result.estado === 'SOLICITADO' || SHOW_FULL_DETAILS) {
          return result;
        } else {
          const { detalle, ...cabecera } = result;
          return cabecera;
        }
      });

      console.log('Resultados obtenidos:', filteredResults);
      console.log = originalConsoleLog;
      console.log('✅ 3. RESULTADOS OBTENIDOS EXITOSAMENTE');
      await page.close(); // Cerrar la página de consulta al final
      console.log(`Fin de solicitud: ${Date.now() - startTime} ms`);
      isFirstRequest = false; // Marcar que la primera consulta ya se realizó
      return res.status(200).json({ results: filteredResults });
    } catch (err) {
      console.error(`Error en intento ${attempt}:`, err.message);
      if (page) await page.close();
      attempt++;
      if (attempt > retries) {
        console.log = originalConsoleLog;
        console.log(`Fin de solicitud con error: ${Date.now() - startTime} ms`);
        isFirstRequest = false; // Marcar que la primera consulta ya se realizó
        return res.status(500).json({ error: `Error tras ${retries} intentos: ${err.message}` });
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${port}`);
});

process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
  console.log = originalConsoleLog;
  console.log('🛑 SERVER CERRADO');
  process.exit();
});