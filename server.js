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

const app = express();
app.use(express.json());

// Función para escribir logs en el archivo
const writeLogToFile = (message) => {
  fs.appendFileSync('logs.txt', `${new Date().toISOString()} - ${message}\n`, 'utf8');
};

// ===== Config extra para DETALLE =====
const OSINERG_BASE = 'https://pvo.osinergmin.gob.pe';
const DETALLE_ENDPOINT = `${OSINERG_BASE}/scopglp3/servlet/com.osinerg.scopglp.servlets.ConsultaOrdenPedidoServlet`;
const MAX_DETALLES = Number.parseInt(process.env.MAX_DETALLES || '999999', 10);

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

// Abrir detalle (opc=2), guardar HTML+PNG y extraer JSON
async function obtenerYGuardarDetalle(context, codigoAutorizacion, refererUrl, outDir) {
  const url = `${DETALLE_ENDPOINT}?codigoAutorizacion=${encodeURIComponent(codigoAutorizacion)}&opc=2`;
  const page = await context.newPage();
  try {
    // UA consistente
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    if (refererUrl) await page.setExtraHTTPHeaders({ Referer: refererUrl });

    // (Opcional) ahorrar recursos
    if (process.env.SAVE_LIGHT === '1') {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const t = req.resourceType();
        if (['image', 'font', 'stylesheet'].includes(t)) req.abort();
        else req.continue();
      });
    }

    console.log(`Abriendo detalle ${codigoAutorizacion}: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Guardar HTML + Screenshot
    const base = path.join(outDir, `detalle_${codigoAutorizacion}`);
    const htmlPath = `${base}.html`;
    const pngPath = `${base}.png`;
    const html = await page.content();
    // fs.writeFileSync(htmlPath, html, 'utf8');
    await page.screenshot({ path: pngPath, fullPage: true });

    // Parsear contenido a JSON
    const detalle = await page.evaluate(() => {
      const norm = (s) => (s || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const limpiarParentesis=(texto)=> {
        return texto.replace(/[()]/g, '').toUpperCase();
      }
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
        camion: { placa: '', capacidadKg: '',un:'' },
        productos: [],
        totales: {}
      };

      // ------- Cabecera (Tabla .TblFiltros) -------
      const tblFiltros = document.querySelector('table.TblFiltros');
      if (tblFiltros) {
        const filas = Array.from(tblFiltros.querySelectorAll('tr.Fila'));

        // Primera fila (Celda3) con título largo
        const celda3 = tblFiltros.querySelector('.Celda3');
        if (celda3) out.cabeceraTitulo = norm(celda3.textContent);

        // Pares etiqueta/valor en celdas .Celda2
        filas.forEach((tr) => {
          const tds = Array.from(tr.querySelectorAll('.Celda2'));
          if (tds.length === 2) {
            const label = norm(tds[0].textContent).toLowerCase();
            const value = norm(tds[1].textContent);

            if (label.includes('agente vendedor')) out.agenteVendedor = value;
            else if (label.includes('tipo vendedor')) out.tipoVendedor = value;
            else if (label.includes('código autorización')) out.codigoAutorizacion = value;
            else if (label.includes('código referencia')) out.codigoReferencia = value === '&' ? '' : value; // por si viene &nbsp;
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

      // ------- Tabla camión (buscar por texto "Placa del Camión") -------
      const allTables = Array.from(document.querySelectorAll('table'));
      const camionTable = allTables.find((tb) => tb.textContent && tb.textContent.includes('Placa del Camión'));
      if (camionTable) {
        const tds = Array.from(camionTable.querySelectorAll('td.Celda2'));
        // Estructura esperada: [ "Placa del Camión", "AUT-705", "Capacidad Autorizada del Camión", "2520 (kg.)" ]
        if (tds.length >= 4) {
          let weigth = norm(tds[3].innerText)
          out.camion.placa = norm(tds[1].innerText || tds[1].textContent);
          out.camion.capacidadKg = norm(weigth.split[0] || tds[3].textContent.split(" ")[0]);
          out.camion.un = limpiarParentesis(weigth.split(" ")[1]) || "";
        } else {
          // Alternativa por posiciones (algunas páginas usan 4 celdas en una sola fila)
          const tr = camionTable.querySelector('tr.Fila');
          if (tr) {
            const c = Array.from(tr.querySelectorAll('td.Celda2')).map((x) => norm(x.innerText || x.textContent));
            if (c.length >= 4) {
              out.camion.placa = c[1] || '';
              out.camion.capacidadKg = c[3].split(" ")[0] || '';
              out.camion.un = limpiarParentesis(c[3].split(" ")[1]) || '';
            }
          }
        }
      }

      // ------- Tabla de productos (TblResultado con headers "Producto", "Marca", ...) -------
      const prodTable = Array.from(document.querySelectorAll('table.TblResultado')).find((tb) => {
        const headerRow = tb.querySelector('tr.Fila');
        if (!headerRow) return false;
        const headers = Array.from(headerRow.querySelectorAll('td.Celda, th.Celda')).map((h) => norm(h.textContent).toLowerCase());
        return headers.includes('producto') && headers.includes('marca');
      });

      if (prodTable) {
        const rows = Array.from(prodTable.querySelectorAll('tr.Fila'));
        if (rows.length) {
          // La primera fila es el header
          const dataRows = rows.slice(1);

          dataRows.forEach((tr) => {
            const cells = Array.from(tr.querySelectorAll('td.Celda1, td.Celda'));
            const texts = cells.map((c) => norm(c.innerText || c.textContent));
            if (!texts.length) return;

            // Detectar fila de TOTAL (suele tener "TOTAL" y colspan)
            const joined = texts.join(' ').toLowerCase();
            const isTotal = joined.includes('total') && texts.length >= 4;

            if (isTotal) {
              // En tu HTML: última fila tiene cantidadRecibida en la penúltima celda visible
              // Estructura (ejemplo):
              // [ 'TOTAL', '', '', '', '20', '200', '' ] con Celda o Celda1
              // Tomamos los últimos valores numéricos plausibles
              const nums = texts.filter((t) => t && t !== '&' && t !== 'TOTAL' && !isNaN(Number(t)));
              if (nums.length) {
                // Heurística: último es subtotalKg, el anterior cantidadRecibida
                const last = nums[nums.length - 1];
                const prev = nums[nums.length - 2] || '';
                out.totales = { cantidadRecibida: prev, subtotalKg: last };
              }
            } else {
              // Fila normal de producto: columnas esperadas según tu HTML
              // Producto, Marca, Cantidad Pedida, Cantidad Aceptada, Cantidad Vendida, Cantidad Recibida, Subtotal (Kg.), Estado
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
              // Evitar empujar filas vacías
              const hasAny = Object.values(prod).some((v) => v);
              if (hasAny) out.productos.push(prod);
            }
          });
        }
      }

      return out;
    });

    return {
      url,
      htmlPath,
      pngPath,
      detalle
    };
  } catch (e) {
    console.error(`Error procesando detalle ${codigoAutorizacion}:`, e.message);
    return { url, error: e.message };
  } finally {
    await page.close();
  }
}

app.post('/api/scrape', async (req, res) => {
  const { codigo_autorizacion, txt_fecini, txt_fecfin } = req.body;

  // Limpiar el archivo de logs al inicio de cada consulta
  fs.writeFileSync('logs.txt', '', 'utf8');

  // Validar parámetros de entrada
  if (!codigo_autorizacion || !txt_fecini || !txt_fecfin) {
    console.log = originalConsoleLog; // Restaurar para la respuesta
    return res.status(400).json({ error: 'Faltan parámetros requeridos: codigo_autorizacion, txt_fecini, txt_fecfin' });
  }

  let retries = 3;
  let attempt = 1;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    while (attempt <= retries) {
      try {
        console.log(`Intento ${attempt} de ${retries}...`);
        const page = await browser.newPage();

        // Habilitar logs de red
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

        // Establecer user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // 1. Login
        console.log('Accediendo a login...');
        await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', { waitUntil: 'networkidle2', timeout: 30000 });
        console.log = originalConsoleLog; // Restaurar para mostrar mensaje en pantalla
        console.log('🌐 1. SE INGRESÓ A LA PÁGINA');
        console.log = (...args) => writeLogToFile(args.join(' ')); // Volver a redirigir

        // Esperar formulario
        await page.waitForSelector('input[name="j_username"]', { timeout: 15000 });
        console.log('Formulario de login cargado');

        // Verificar credenciales
        console.log('Credenciales:', process.env.OSINERGMIN_USERNAME, process.env.OSINERGMIN_PASSWORD);
        if (!process.env.OSINERGMIN_USERNAME || !process.env.OSINERGMIN_PASSWORD) {
          throw new Error('Credenciales no definidas en el archivo .env');
        }
        await page.type('input[name="j_username"]', process.env.OSINERGMIN_USERNAME);
        await page.type('input[name="j_password"]', process.env.OSINERGMIN_PASSWORD);

        // Intentar obtener token de reCAPTCHA (best effort)
        let recaptchaToken = null;
        try {
          recaptchaToken = await page.evaluate(() => {
            return new Promise((resolve) => {
              try {
                // eslint-disable-next-line no-undef
                grecaptcha.ready(() => {
                  // eslint-disable-next-line no-undef
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

        // Enviar formulario de login
        await Promise.all([
          page.click('button[type="submit"]'),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
            console.log('Navegación después del login no completada, continuando...');
          }),
        ]);
        console.log('Login enviado');
        console.log(`URL después del login: ${page.url()}`);

        // Verificar si el login falló
        if (page.url().includes('login?error=UP')) {
          throw new Error('Fallo en el login: credenciales inválidas o problema con reCAPTCHA');
        }

        // 2. Activar módulo de consulta
        console.log('Activando módulo de consulta...');
        await page.waitForFunction('typeof muestraPagina === "function"', { timeout: 15000 });
        await page.evaluate(() => muestraPagina('163', 'NO', 'NO'));
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log = originalConsoleLog; // Restaurar para mostrar mensaje en pantalla
        console.log('📄 2. SE INGRESÓ AL CONTENIDO DE LA PÁGINA');
        console.log = (...args) => writeLogToFile(args.join(' ')); // Volver a redirigir

        // 3. Enviar POST con el formulario
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

        await page.goto('https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp', { waitUntil: 'networkidle2', timeout: 30000 });

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

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

        // 4. Esperar explícitamente a que la tabla esté presente
        console.log('Esperando tabla de resultados...');
        await page.waitForSelector('table.TblResultado', { timeout: 15000 }).catch(() => {
          console.log('No se encontró la tabla TblResultado');
        });

        // 5. Extraer resultado con manejo de errores
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

        // Depurar el contenido de la página
        const pageContent = await page.content();
        console.log('Contenido de la página:', pageContent.substring(0, 500), '...');

        if (results.error) {
          console.log = originalConsoleLog; // Restaurar console.log
          return res.status(200).json({ results: [], message: results.error });
        }

        // 6) NUEVO: abrir detalle, guardar y parsear para cada fila
        const outDir = tsFolder();
        const ctx = page.browserContext();
        const referer = page.url();
        const limite = Math.min(results.length, MAX_DETALLES);

        for (let i = 0; i < limite; i++) {
          const r = results[i];
          if (!r.codigoAutorizacion) {
            r.detalle = { error: 'Sin codigoAutorizacion' };
            continue;
          }
          const det = await obtenerYGuardarDetalle(ctx, r.codigoAutorizacion, referer, outDir);
          // Inyectar en JSON
          if (det.detalle) r.detalle = det.detalle;
          else r.detalle = { error: det.error || 'No se pudo parsear detalle' };
          // r.detalleArchivos = { url: det.url, htmlPath: det.htmlPath, pngPath: det.pngPath };
        }

        console.log('Resultados obtenidos:', results);
        console.log = originalConsoleLog; // Restaurar para mostrar mensaje en pantalla
        console.log('✅ 3. RESULTADOS OBTENIDOS EXITOSAMENTE');
        return res.status(200).json({
          results        });

      } catch (err) {
        console.error(`Error en intento ${attempt}:`, err.message);
        if (attempt === retries) {
          console.log = originalConsoleLog; // Restaurar console.log
          return res.status(500).json({ error: `Error tras ${retries} intentos: ${err.message}` });
        }
        attempt++;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } finally {
    if (browser) {
      await browser.close();
      browser = null; // Limpiar la variable global
      console.log = originalConsoleLog; // Restaurar console.log
      console.log('🧹 NAVEGADOR CERRADO');
    }
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${port}`);
});

process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
    browser = null; // Limpiar la variable global
  }
  console.log = originalConsoleLog; // Restaurar console.log
  console.log('🛑 SERVER CERRADO');
  process.exit();
});
