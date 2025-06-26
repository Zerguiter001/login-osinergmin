const puppeteer = require('puppeteer');
const qs = require('qs');
const fs = require('fs');
 
(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
 
    // 1. Login
    console.log('🔗 Accediendo a login...');
    await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', { waitUntil: 'networkidle2' });
    await page.type('input[name="j_username"]', '0322100');
    await page.type('input[name="j_password"]', '12597083');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);
    console.log('✅ Login exitoso');
 
    // 2. Activar módulo de consulta
    console.log('📄 Activando módulo de consulta...');
    await page.waitForFunction('typeof muestraPagina === "function"', { timeout: 15000 });
    await page.evaluate(() => muestraPagina('163', 'NO', 'NO'));
    await new Promise(resolve => setTimeout(resolve, 3000));
 
 
    // 3. Enviar POST con el formulario
    console.log('📤 Enviando formulario POST...');
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
 
    await page.goto('https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp', { waitUntil: 'networkidle2' });
 
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
 
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
 
    // 4. Guardar resultado
    const htmlContent = await page.content();
    fs.writeFileSync('respuesta.html', htmlContent);
    console.log('✅ HTML guardado en respuesta.html');
 
    const plainText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('respuesta.txt', plainText);
    console.log('✅ Texto plano guardado en respuesta.txt');
 
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('🧹 Navegador cerrado');
    }
  }
})();