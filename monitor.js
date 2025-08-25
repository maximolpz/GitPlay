// monitor.js
const { getOctokit } = require('@actions/github');
const { getInput } = require('@actions/core');
const { chromium } = require('playwright');
const fs = require('fs');

// Configuración
const octokit = getOctokit(process.env.GITHUB_TOKEN);
const owner = 'maximolpz';
const repo = 'LowPriceMonitor';
const dataFile = 'data/tracked-products.json';

// Leer historial de precios
let tracked = {};
if (fs.existsSync(dataFile)) {
  tracked = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
}

// Extraer URL del cuerpo del issue
async function extractUrlFromIssue(body) {
  const urlMatch = body.match(/https?:\/\/[^\s"']+/);
  return urlMatch ? urlMatch[0] : null;
}

// Obtener precio según plataforma
async function getPrice(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url, { timeout: 30000 });

    let price = null;

    if (url.includes('steampowered.com')) {
      const priceText = await page.locator('.discount_final_price').first().textContent();
      price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
    }

    if (url.includes('mercadolibre.com')) {
      const fraction = await page.locator('span.andes-money-amount__fraction').first().textContent();
      const cents = await page.locator('span.andes-money-amount__cents').first().textContent() || '00';
      price = parseFloat(`${fraction}.${cents}`);
    }

    await browser.close();
    return price;
  } catch (error) {
    await browser.close();
    throw new Error(`Error al obtener precio: ${error.message}`);
  }
}

// Función principal
async function run() {
  const payload = require(process.env.GITHUB_EVENT_PATH);
  const event = process.env.GITHUB_EVENT_NAME;

  try {
    // Si es un issue nuevo, agregarlo al seguimiento
    if (event === 'issues' && payload.action === 'opened') {
      if (!payload.issue) {
        console.error('Error: payload.issue es undefined');
        return;
      }
      const url = await extractUrlFromIssue(payload.issue.body);
      if (!url) {
        await octokit.issues.createComment({
          owner, repo,
          issue_number: payload.issue.number,
          body: '❌ No se encontró un enlace válido en el issue. Por favor, agrega una URL de Steam o MercadoLibre.'
        });
        return;
      }

      const currentPrice = await getPrice(url);
      if (!currentPrice) {
        await octokit.issues.createComment({
          owner, repo,
          issue_number: payload.issue.number,
          body: '❌ No se pudo obtener el precio del producto. Revisa que la URL sea correcta.'
        });
        return;
      }

      // Guardar en historial
      tracked[url] = {
        issueNumber: payload.issue.number,
        initialPrice: currentPrice,
        lastChecked: new Date().toISOString()
      };

      fs.writeFileSync(dataFile, JSON.stringify(tracked, null, 2));

      await octokit.issues.createComment({
        owner, repo,
        issue_number: payload.issue.number,
        body: `✅ Producto agregado al monitoreo.\n\n🔗 ${url}\n💰 Precio inicial: $${currentPrice}\n🔄 Se verificará cada 6 horas.`
      });
    }

    // Si es ejecución programada, verifica todos los productos
    if (event === 'schedule') {
      for (const [url, data] of Object.entries(tracked)) {
        try {
          const currentPrice = await getPrice(url);
          const { initialPrice, issueNumber } = data;

          if (currentPrice < initialPrice) {
            await octokit.issues.createComment({
              owner, repo,
              issue_number: issueNumber,
              body: `🎉 ¡PRECIO BAJÓ!\n\nAntes: $${initialPrice}\nAhora: $${currentPrice}\n\n${url}`
            });

            // Actualizar precio inicial
            tracked[url].initialPrice = currentPrice;
          } else {
            console.log(`Precio sin cambios: $${currentPrice} (mínimo: $${initialPrice})`);
          }
        } catch (error) {
          console.error(`Error checking ${url}:`, error.message);
          // Opcional: comentar en el issue si falla
        }
      }

      // Guardar cambios
      fs.writeFileSync(dataFile, JSON.stringify(tracked, null, 2));
    }
  } catch (error) {
    console.error('Error general:', error);
    // Opcional: notificar error
  }
}

// Ejecutar
run();