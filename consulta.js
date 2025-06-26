const puppeteer = require('puppeteer');
const axios = require('axios');
const qs = require('qs');
const fs = require('fs');

(async () => {
  try {
    // 1. Iniciar el navegador con Puppeteer en modo visible
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // 2. Ir a la página de login
    console.log('🔗 Accediendo a la página de login...');
    await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', { waitUntil: 'networkidle2' });
    await page.type('input[name="j_username"]', '0322100');
    await page.type('input[name="j_password"]', '12597083');

    // 3. Hacer clic en el botón de login y esperar la navegación
    console.log('🔑 Iniciando sesión...');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);
    console.log('✅ Login con Puppeteer completado');

    // 4. Visitar módulo de consulta para activar la sesión
    console.log('📄 Accediendo al módulo de consulta...');
    try {
      await page.waitForFunction('typeof muestraPagina === "function"', { timeout: 30000 });
      await page.evaluate(() => {
        muestraPagina('163', 'NO', 'NO');
      });
    } catch (error) {
      console.error('⚠️ Error al ejecutar muestraPagina:', error.message);
    }

    // 5. Verificar si se abrió una nueva pestaña y activarla
    const pages = await browser.pages();
    const consultaPage = pages.length > 1 ? pages[pages.length - 1] : page;
    await consultaPage.bringToFront();
    console.log(`🖥️ Pestaña activa: ${await consultaPage.title()}`);
    console.log(`🌐 URL de la pestaña activa: ${await consultaPage.url()}`);

    // 6. Obtener cookies de sesión
    const cookiesArray = await consultaPage.cookies();
    const cookieHeader = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');
    console.log('🍪 Cookies obtenidas:', cookieHeader);

    // 7. Visitar cabecera.jsp para evitar bloqueo por WAF
    console.log('🔗 Visitando cabecera.jsp para mantener la sesión...');
    try {
      await axios.get('https://pvo.osinergmin.gob.pe/scopglp3/cabecera.jsp', {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      console.log('✅ cabecera.jsp visitada con éxito');
    } catch (error) {
      console.error('⚠️ Error al visitar cabecera.jsp:', error.message);
    }

    // 8. Preparar payload para la consulta
    const payload = qs.stringify({
      ind: '',
      opc: '1',
      codvendope: '',
      codigoAgente: '',
      tipoUsuario: 'C',
      codigo_referencia: '',
      codigo_autorizacion: '60825331621',
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
      txt_fecini: '27/01/2020',
      txt_fecfin: '27/01/2020'
    });

    // 9. Intentar solicitud POST desde Puppeteer
    console.log('📤 Enviando solicitud POST desde Puppeteer...');
    try {
      await consultaPage.goto('https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp', { waitUntil: 'networkidle2' });
      await consultaPage.evaluate((payload) => {
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
      await consultaPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      const pageContent = await consultaPage.content();
      fs.writeFileSync('respuesta-puppeteer.html', pageContent);
      console.log('✅ Resultado de Puppeteer guardado en respuesta-puppeteer.html');
    } catch (error) {
      console.error('⚠️ Error en la solicitud POST desde Puppeteer:', error.message);
      const errorContent = await consultaPage.content();
      fs.writeFileSync('error-puppeteer.html', errorContent);
      console.log('📝 Error de Puppeteer guardado en error-puppeteer.html');
    }

    // 10. Intentar solicitud POST con Axios (como respaldo)
    console.log('📤 Enviando solicitud POST con Axios...');
    try {
      const response = await axios.post(
        'https://pvo.osinergmin.gob.pe/scopglp3/servlet/com.osinerg.scopglp.servlets.ConsultaOrdenPedidoServlet',
        payload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Cookie': cookieHeader,
            'Referer': 'https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp',
            'Origin': 'https://pvo.osinergmin.gob.pe',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
          }
        }
      );
      console.log('✅ Respuesta recibida:', response.status);
      fs.writeFileSync('respuesta-axios.html', response.data);
      console.log('✅ Resultado de Axios guardado en respuesta-axios.html');
    } catch (error) {
      console.error('⚠️ Error en la solicitud POST con Axios:', error.response ? error.response.status : error.message);
      if (error.response && error.response.data) {
        fs.writeFileSync('error-axios.html', error.response.data);
        console.log('📝 Respuesta de error guardada en error-axios.html');
      }
    }

    // 11. Realizar acciones adicionales en la página
    console.log('🖥️ Navegador y páginas abiertas. Agrega tus acciones aquí.');
    // Ejemplo: Tomar una captura de pantalla de la página activa
    await consultaPage.screenshot({ path: 'captura-consulta.png' });
    console.log('✅ Captura guardada como captura-consulta.png');

    // Ejemplo: Extraer contenido de la página
    const pageText = await consultaPage.evaluate(() => document.body.innerText);
    console.log('📋 Contenido de la página activa:', pageText);

    // 12. Mantener el script activo hasta que lo detengas manualmente
    console.log('🔄 Presiona Ctrl+C para cerrar el navegador y finalizar el script.');
    await new Promise(resolve => {});

  } catch (error) {
    console.error('❌ Error general en el script:', error.message);
    // No cerrar el navegador para permitir inspección
  }
})();