// monitor.js
const fs = require('fs');
const { chromium } = require('playwright');

// === Verificar dependencias críticas ===
let octokit;
let core;

try {
  const { getOctokit } = require('@actions/github');
  const { getInput } = require('@actions/core');
  core = getInput;
  octokit = getOctokit(process.env.GITHUB_TOKEN);

  if (!octokit) {
    console.error('❌ Error: octokit no se pudo inicializar. ¿Está @actions/github instalado?');
  } else {
    console.log('✅ octokit inicializado correctamente');
  }
} catch (error) {
  console.error('❌ Error al cargar @actions/github o @actions/core:', error.message);
}

// === Configuración ===
const owner = 'maximolpz';           // ← Cambia si tu usuario es distinto
const repo = 'LowPriceMonitor';      // ← Nombre de tu repositorio
const dataFile = 'data/tracked-products.json';

// === Leer historial de precios ===
let tracked = {};
if (fs.existsSync(dataFile)) {
  const content = fs.readFileSync(dataFile, 'utf-8').trim();
  if (content) {
    try {
      tracked = JSON.parse(content);
      console.log('✅ Historial de precios cargado:', Object.keys(tracked).length, 'productos');
    } catch (error) {
      console.error('❌ Error al parsear tracked-products.json:', error.message);
      tracked = {};
    }
  } else {
    console.log('⚠️  tracked-products.json está vacío. Iniciando con historial vacío.');
  }
} else {
  console.log('⚠️  No existe tracked-products.json. Se creará al primer monitoreo.');
}

// === Extraer URL del cuerpo del issue ===
async function extractUrlFromIssue(body) {
  const urlMatch = body.match(/https?:\/\/[^\s"']+/);
  return urlMatch ? urlMatch[0] : null;
}

// === Obtener precio según plataforma ===
async function getPrice(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`🔍 Navegando a: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Esperar un poco más para contenido dinámico
    await page.waitForTimeout(2000);

    let price = null;

    // === Steam ===
    if (url.includes('steampowered.com')) {
      const selectors = [
        '.discount_final_price',   // Precio con descuento
        '.game_purchase_price',    // Precio sin descuento
        '.price'                   // Clase genérica
      ];

      for (const selector of selectors) {
        const element = await page.locator(selector).first().textContent();
        if (element) {
          const clean = element.replace(/[^\d.,]/g, '').replace(',', '.');
          price = parseFloat(clean);
          if (!isNaN(price)) break;
        }
      }
    }

    // === MercadoLibre ===
    if (url.includes('mercadolibre.com')) {
      const fraction = await page.locator('span.andes-money-amount__fraction').first().textContent();
      if (fraction) {
        const cents = await page.locator('span.andes-money-amount__cents').first().textContent() || '00';
        price = parseFloat(`${fraction}.${cents}`);
      }
    }

    await browser.close();

    if (!price || isNaN(price)) {
      throw new Error('No se pudo extraer un precio válido');
    }

    console.log(`✅ Precio obtenido: $${price}`);
    return price;
  } catch (error) {
    await browser.close();
    console.error(`❌ Error al obtener precio de ${url}:`, error.message);
    throw error;
  }
}

// === Función principal ===
async function run() {
  try {
    // Cargar evento de GitHub
    const payloadPath = process.env.GITHUB_EVENT_PATH;
    if (!payloadPath) {
      console.error('❌ GITHUB_EVENT_PATH no definido');
      return;
    }

    const payload = require(payloadPath);
    const event = process.env.GITHUB_EVENT_NAME;

    if (!octokit) {
      console.error('❌ octokit no está disponible. No se puede continuar.');
      return;
    }

    // === Caso 1: Nuevo issue ===
    if (event === 'issues' && payload.action === 'opened') {
      const issueNumber = payload.issue.number;
      const body = payload.issue.body;
      const url = await extractUrlFromIssue(body);

      if (!url) {
        console.log(`❌ No se encontró URL en el issue #${issueNumber}`);
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: '❌ No se encontró un enlace válido. Por favor, agrega una URL de Steam o MercadoLibre.'
        });
        return;
      }

      try {
        const currentPrice = await getPrice(url);

        // Guardar en historial
        tracked[url] = {
          issueNumber,
          initialPrice: currentPrice,
          lastChecked: new Date().toISOString()
        };

        fs.writeFileSync(dataFile, JSON.stringify(tracked, null, 2));

        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: `✅ Producto agregado al monitoreo.\n\n🔗 ${url}\n💰 Precio inicial: $${currentPrice}\n🔄 Se verificará cada 6 horas.`
        });

        console.log(`✅ Issue #${issueNumber} procesado. Precio inicial: $${currentPrice}`);
      } catch (error) {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: `❌ No se pudo obtener el precio del producto. Revisa que la URL sea correcta o que el producto esté disponible.\n\n> ${error.message}`
        });
      }
    }

    // === Caso 2: Ejecución programada (cada 6h) ===
    if (event === 'schedule') {
      console.log(`📅 Iniciando verificación programada. Productos a monitorear: ${Object.keys(tracked).length}`);

      for (const [url, data] of Object.entries(tracked)) {
        try {
          const currentPrice = await getPrice(url);
          const { initialPrice, issueNumber } = data;

          if (currentPrice < initialPrice) {
            console.log(`🎉 ¡Precio bajó! De $${initialPrice} a $${currentPrice} en ${url}`);

            await octokit.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body: `🎉 ¡PRECIO BAJÓ!\n\n📉 Antes: $${initialPrice}\n💰 Ahora: $${currentPrice}\n🔗 ${url}`
            });

            // Actualizar precio inicial
            tracked[url].initialPrice = currentPrice;
          } else {
            console.log(`➡️ Precio sin cambios: $${currentPrice} (mínimo: $${initialPrice})`);
          }
        } catch (error) {
          console.error(`❌ Error verificando ${url}:`, error.message);
        }
      }

      // Guardar cambios (por si hubo bajadas de precio)
      fs.writeFileSync(dataFile, JSON.stringify(tracked, null, 2));
      console.log('✅ Historial actualizado');
    }
  } catch (error) {
    console.error('❌ Error general en run():', error.message);
  }
}

// === Ejecutar ===
run().catch(err => {
  console.error('❌ Error no manejado:', err);
});