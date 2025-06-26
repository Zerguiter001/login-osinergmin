const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');

// Leer cookies desde archivo
const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

// Datos del formulario
const formData = new URLSearchParams({
  ind: '',
  opc: '1',
  codvendope: '',
  codigoAgente: '',
  tipoUsuario: 'C',
  codigo_referencia: '',
  codigo_autorizacion: '60825331621', // SCOP
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
  txt_fecfin: '26/06/2025'
});

(async () => {
  try {
    // Paso 1: hacer POST con los filtros
    const buscar = await axios.post(
      'https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp',
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp'
        }
      }
    );

    console.log('✅ Filtros enviados correctamente.');

    // Paso 2: ahora accedemos al iframe que contiene la tabla de resultados
    const listado = await axios.get(
      'https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido_listado.jsp',
      {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://pvo.osinergmin.gob.pe/scopglp3/jsp/consultas/consulta_orden_pedido.jsp'
        }
      }
    );

    const html = listado.data;
    fs.writeFileSync('resultado-iframe.html', html);

    // Analizar resultado
    const $ = cheerio.load(html);
    const filas = $('table tr');

    if (filas.length <= 1) {
      console.log('📭 No se encontró ningún resultado.');
    } else {
      console.log(`📄 Se encontraron ${filas.length - 1} resultados:`);

      filas.each((i, row) => {
        if (i === 0) return; // saltar encabezado
        const columnas = $(row).find('td').map((j, td) => $(td).text().trim()).get();
        console.log(`🔹 Registro ${i}:`, columnas);
      });
    }

  } catch (error) {
    console.error('❌ Error en la consulta SCOP:');
    if (error.response) {
      console.log('Código HTTP:', error.response.status);
      console.log(error.response.data);
    } else {
      console.error(error.message);
    }
  }
})();
