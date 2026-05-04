import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { Browser, Page } from "playwright";

// Usar el plugin de sigilo
chromium.use(stealth());

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/oficios_db";

let db: Db | null = null;
let inMemoryOficios: any[] = [];

async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
    db = client.db();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Failed to connect to MongoDB. Using in-memory fallback.");
  }
}

connectDB();

app.use(express.json());

    // Scraper logic
async function runScraper(socketId: string) {
  const socket = io.to(socketId);
  const sendScreenshot = async (page: Page, step: string) => {
    try {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
      const base64 = screenshot.toString('base64');
      socket.emit("screenshot", { image: base64, step });
    } catch (e) {
      console.error("Error taking screenshot", e);
    }
  };

  socket.emit("status", { message: "Iniciando scraper...", status: "starting" });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
      ]
    });
    // Crear contexto con configuración de sigilo reforzada
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1,
      hasTouch: false,
      locale: 'es-CL',
      timezoneId: 'America/Santiago',
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    // Inyectar script para ocultar webdriver
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    const url = "https://www.camara.cl/fiscalizacion/oficios_fiscalizacion/consulta_oficios.aspx";

    socket.emit("status", { message: `Iniciando navegación sigilosa a ${url}`, status: "navigating" });
    
    // Navegación con timeout más largo y menos dependiente de 'networkidle'
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    
    await sendScreenshot(page, "Página Inicial");

    // Verificar si estamos bloqueados
    const pageTitle = await page.title();
    const bodyText = await page.innerText('body');
    if (bodyText.includes("blocked") || bodyText.includes("Forbidden") || pageTitle.includes("Access Denied")) {
      socket.emit("status", { message: "❌ BLOQUEO DETECTADO: El servidor ha rechazado la conexión.", status: "error" });
      await sendScreenshot(page, "Bloqueo Confirmado");
      throw new Error("Acceso bloqueado por el servidor (WAF)");
    }

    // Seleccionar 'Diputado' (Enlace que hace Postback)
    socket.emit("status", { message: "Buscando enlace 'Diputado'...", status: "selecting" });
    const linkDiputadoSelector = '[id$="link_porDiputado"]';
    await page.waitForSelector(linkDiputadoSelector, { state: "visible", timeout: 15000 });
    
    socket.emit("status", { message: "Paso 1: Haciendo clic en enlace 'Diputado'", status: "clicking_link" });
    // Al ser un __doPostBack, esperamos a que termine cualquier transacción de red
    await Promise.all([
        page.waitForLoadState('networkidle'),
        page.click(linkDiputadoSelector)
    ]);
    
    await page.waitForTimeout(3000); // Espera estratégica para carga de UpdatePanel
    await sendScreenshot(page, "Después de clic Diputado");

    // Esperar a que el selector de diputados aparezca
    const ddlDiputadoSelector = '[id$="ddlDiputados"]';
    socket.emit("status", { message: "Paso 2: Buscando el select de Diputados...", status: "waiting_selector" });
    
    try {
        await page.waitForSelector(ddlDiputadoSelector, { state: "visible", timeout: 15000 });
        socket.emit("status", { message: "✅ Selector 'ddlDiputados' encontrado.", status: "selector_confirmed" });
    } catch (err) {
        socket.emit("status", { message: "❌ ERROR: No se encontró el selector de Diputados. Revisa la captura.", status: "error" });
        await sendScreenshot(page, "ERROR: Selector No Encontrado");
        throw new Error("Selector de diputados no encontrado");
    }

    const diputadosOptions = await page.evaluate((sel) => {
      const select = document.querySelector(sel) as HTMLSelectElement;
      if (!select) return [];
      return Array.from(select.options)
        .map(opt => ({ value: opt.value, text: opt.text }))
        .filter(opt => opt.value !== "0" && opt.value !== "");
    }, ddlDiputadoSelector);

    socket.emit("status", { message: `Detectados ${diputadosOptions.length} diputados.`, status: "ready" });
    await sendScreenshot(page, "Lista de Diputados Cargada");

    for (const diputado of diputadosOptions.slice(0, 5)) { // Limitamos a 5 para el demo
      socket.emit("status", { 
        message: `Paso 3: Seleccionando al Diputado ${diputado.text}...`, 
        status: "step_selecting", 
        currentDiputado: diputado.text 
      });

      await page.selectOption(ddlDiputadoSelector, diputado.value);
      await page.waitForTimeout(1500);
      
      socket.emit("status", { 
        message: `Paso 4: Presionando botón 'Buscar' para ${diputado.text}`, 
        status: "step_clicking",
        currentDiputado: diputado.text 
      });
      
      const btnBuscarSelector = '[id$="btnBuscar"]';
      await Promise.all([
          page.waitForLoadState('networkidle'),
          page.click(btnBuscarSelector)
      ]);

      socket.emit("status", { message: "Paso 5: Esperando resultados...", status: "waiting_results" });
      await page.waitForTimeout(4000);
      await sendScreenshot(page, `Resultados de ${diputado.text}`);

      const searchTitleSelector = '[id$="titulo_busqueda"]';
      const searchTitleVisible = await page.isVisible(searchTitleSelector);
      if (searchTitleVisible) {
        const titleText = await page.innerText(searchTitleSelector);
        socket.emit("status", { message: `✅ Confirmado por Título: ${titleText}`, status: "search_confirmed" });
      }

      // Extracción de datos
      const rows = await page.evaluate((diputadoText) => {
        const tableRows = Array.from(document.querySelectorAll("table.gridview tr, .tabla-oficios tr")).slice(1);
        return tableRows.map(row => {
          const cols = row.querySelectorAll("td");
          if (cols.length < 5) return null;
          return {
            diputado: diputadoText,
            numeroOficio: cols[0]?.innerText.trim(),
            fecha: cols[1]?.innerText.trim(),
            materia: cols[2]?.innerText.trim(),
            institucion: cols[3]?.innerText.trim(),
            estado: cols[4]?.innerText.trim(),
            scrapedAt: new Date()
          };
        }).filter(r => r !== null);
      }, diputado.text);

      if (rows.length > 0) {
        if (db) await db.collection("Oficios").insertMany(rows);
        else inMemoryOficios = [...rows, ...inMemoryOficios].slice(0, 500);
        socket.emit("data_rows", rows);
      }
    }

    socket.emit("status", { message: "Scraping finalizado.", status: "completed" });

  } catch (error: any) {
    console.error("Scraper Error:", error);
    socket.emit("status", { message: `Error fatal: ${error.message}`, status: "error" });
  } finally {
    if (browser) await browser.close();
  }
}

// API Routes
app.get("/api/oficios", async (req, res) => {
  try {
    if (db) {
      const oficios = await db.collection("Oficios").find().sort({ scrapedAt: -1 }).limit(100).toArray();
      return res.json(oficios);
    }
    return res.json(inMemoryOficios);
  } catch (err) {
    res.json(inMemoryOficios); // Always return array
  }
});

// Socket setup
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("start_scraping", () => {
    runScraper(socket.id);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Vite middleware
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
