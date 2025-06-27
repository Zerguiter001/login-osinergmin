require('dotenv').config({ path: 'C:/Users/HOME/Documents/login-osinergmin/.env' });
const express = require('express');
const puppeteer = require('puppeteer');
const qs = require('qs');
const fs = require('fs');

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

        // Intentar obtener token de reCAPTCHA
        let recaptchaToken = null;
        try {
          recaptchaToken = await page.evaluate(() => {
            return new Promise((resolve) => {
              grecaptcha.ready(() => {
                grecaptcha.execute('6LeAU68UAAAAACp0Ci8TvE5lTITDDRQcqnp4lHuD', { action: 'login' })
                  .then(token => resolve(token))
                  .catch(() => resolve(null));
              });
            });
          });
          console.log('Token reCAPTCHA:', recaptchaToken || 'No se obtuvo token');
        } catch (err) {
          console.log('Error al obtener token reCAPTCHA:', err.message);
        }

        // Agregar token al formulario
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

        console.log('Resultados obtenidos:', results);
        console.log = originalConsoleLog; // Restaurar para mostrar mensaje en pantalla
        console.log('✅ 3. RESULTADOS OBTENIDOS EXITOSAMENTE');
        return res.status(200).json({ results });

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