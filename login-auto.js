const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    timeout: 0 // sin límite de tiempo al lanzar navegador
  });

  const page = await browser.newPage();

  try {
    await page.goto('https://pvo.osinergmin.gob.pe/seguridad/login', {
      waitUntil: 'networkidle2',
      timeout: 60000 // espera hasta 60 segundos
    });

    await page.type('input[name="j_username"]', '0322100');
    await page.type('input[name="j_password"]', '12597083');

    // Enviar el formulario y esperar navegación
    await Promise.all([
      page.click('button[type="submit"]'), // asegúrate que sea el botón correcto
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);

    console.log('✅ Login completado');

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
