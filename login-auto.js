const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    timeout: 0
  });

  const page = await browser.newPage();

  try {
    await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.type('input[name="j_username"]', '0322100');
    await page.type('input[name="j_password"]', '12597083');

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);

    console.log('✅ Login completado');

    // ✅ Ir a la página donde luego haces la consulta POST
    await page.goto('https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp', {
      waitUntil: 'networkidle2'
    });

    const cookies = await page.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    console.log('🍪 Cookies guardadas en cookies.json');

    await browser.close();

  } catch (err) {
    console.error('❌ Error en login:', err.message);
    await browser.close();
    process.exit(1);
  }
})();
