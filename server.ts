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
let pendingLinks: any[] = [];

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

    function parseCamaraDate(dateStr: string) {
  const months: Record<string, number> = {
    'Ene': 0, 'Feb': 1, 'Mar': 2, 'Abr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Ago': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dic': 11
  };
  const parts = dateStr.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = months[parts[1]];
  const year = parseInt(parts[2], 10);
  
  if (!isNaN(day) && month !== undefined && !isNaN(year)) {
    return new Date(year, month, day);
  }
  return null;
}

// Scraper logic
async function runScraper(socketId: string, selectedNames?: string[]) {
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
    
    // Simular comportamiento humano: navegar a la raíz primero
    try {
      await page.goto("https://www.camara.cl/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1000 + Math.random() * 2000);
    } catch (e) {
      console.log("Error navigatig to root, but continuing...");
    }

    // Navegación con timeout más largo y menos dependiente de 'networkidle'
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000 + Math.random() * 3000);
    
    await sendScreenshot(page, "Página Inicial");

    // Verificar si estamos bloqueados
    const pageTitle = await page.title();
    const bodyText = await page.innerText('body');
    if (bodyText.includes("blocked") || bodyText.includes("Forbidden") || pageTitle.includes("Access Denied") || bodyText.includes("Cloudflare")) {
      socket.emit("status", { message: "❌ BLOQUEO DETECTADO: El servidor ha rechazado la conexión. Intentando una maniobra de escape...", status: "error" });
      await sendScreenshot(page, "Bloqueo Confirmado");
      
      // Re-intento con cambio de cabeceras si falló
      await page.setExtraHTTPHeaders({
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document'
      });
      await page.waitForTimeout(5000);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await sendScreenshot(page, "Re-intento de Bypass");
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

    const allDiputados = await page.evaluate((sel) => {
      const select = document.querySelector(sel) as HTMLSelectElement;
      if (!select) return [];
      return Array.from(select.options)
        .map(opt => ({ value: opt.value, text: opt.text }))
        .filter(opt => opt.value !== "0" && opt.value !== "");
    }, ddlDiputadoSelector);

    // Si hay seleccionados, filtrar. Si no, procesar todos.
    const diputadosOptions = selectedNames && selectedNames.length > 0
      ? allDiputados.filter(d => selectedNames.includes(d.text))
      : allDiputados;

    socket.emit("status", { message: `Detectados ${allDiputados.length} diputados. Procesando ${diputadosOptions.length} seleccionados.`, status: "ready" });
    await sendScreenshot(page, "Lista de Diputados Cargada");

    for (const diputado of diputadosOptions) {
      // 0. Verificar si ya se completó para este diputado
      if (db) {
        const log = await db.collection("SearchStatus").findOne({ diputado: diputado.text, status: "completed" });
        if (log) {
          socket.emit("status", { message: `Skip: ${diputado.text} ya fue marcado como completado anteriormente.`, status: "skipping" });
          continue;
        }
        await db.collection("SearchStatus").updateOne(
          { diputado: diputado.text },
          { $set: { status: "in_progress", updatedAt: new Date() } },
          { upsert: true }
        );
      }

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

      // 1. Obtener cantidad total de resultados
      const totalResults = await page.evaluate(() => {
        const span = document.querySelector('[id$="cantidad_resultados"]');
        return span ? parseInt(span.textContent || "0", 10) : 0;
      });

      const totalPages = Math.ceil(totalResults / 10);
      let totalValidForDiputado = 0;

      if (db) {
        await db.collection("SearchStatus").updateOne(
          { diputado: diputado.text },
          { $set: { status: "collecting", totalOnSite: totalResults, validLinksFound: 0, updatedAt: new Date() } },
          { upsert: true }
        );
      }

      socket.emit("status", { 
        message: `Total: ${totalResults} resultados detectados. (${totalPages} páginas)`, 
        status: "counting_results" 
      });

      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        socket.emit("status", { 
          message: `Procesando página ${currentPage} de ${totalPages} para ${diputado.text}...`, 
          status: "collecting_links" 
        });

        // Si no es la primera página, navegar a la página correspondiente
        if (currentPage > 1) {
          let clicked = false;
          let retries = 3;
          
          while (retries > 0 && !clicked) {
            const pageResult: any = await page.evaluate((pageNum) => {
              const paginationDiv = document.querySelector(".paginacion.aleft");
              if (!paginationDiv) return { status: "none", detail: "No se encontró el contenedor de paginación" };
              
              const btns = Array.from(paginationDiv.querySelectorAll("a"));
              
              // 1. Siempre intentar buscar el número exacto primero
              const target = btns.find(b => b.textContent?.trim() === pageNum.toString());
              if (target) {
                (target as HTMLElement).click();
                return { status: "clicked", detail: `Clicado número de página ${pageNum}` };
              }

              // 2. Si no se encuentra y es una página de "salto" (11, 21, 31...), buscar directamente el botón por ID
              // En este caso, el clic en el botón de salto ES la navegación a la página deseada
              if (pageNum > 1 && (pageNum % 10 === 1)) {
                const continueBtn = document.getElementById("ContentPlaceHolder1_ContentPlaceHolder1_PaginaContent_pager_rptPager_continue_11");
                if (continueBtn) {
                  (continueBtn as HTMLElement).click();
                  return { status: "clicked", detail: `Navegando a pág de salto ${pageNum} usando botón continue_11` };
                } else {
                  // Fallback por texto "..."
                  const dotsBtn = btns.find(b => b.textContent?.trim() === "...");
                  if (dotsBtn) {
                    (dotsBtn as HTMLElement).click();
                    return { status: "clicked", detail: `Navegando a pág de salto ${pageNum} usando botón '...'` };
                  }
                }
              }

              // 3. Fallback: Si el número no está y no es página de salto exactamente, pulsamos "..." para que aparezca el set de páginas
              const dotsFallback = btns.find(b => 
                (b.textContent?.trim() === "..." || b.id?.includes("continue")) && 
                b.id && b.id.indexOf("continue_11") !== -1
              );
              
              if (dotsFallback) {
                (dotsFallback as HTMLElement).click();
                return { status: "dots", detail: "Clicado dots para revelar el siguiente set de números" };
              }

              return { status: "none", detail: `No se encontró la página ${pageNum} ni botones de continuación` };
            }, currentPage);

            socket.emit("status", { message: `Debug Paginación: ${pageResult.detail}`, status: "debug_paging" });

            if (pageResult.status === "clicked") {
              clicked = true;
              await page.waitForTimeout(10000); 
              await page.waitForLoadState('networkidle');
              socket.emit("status", { message: `Cambio a página ${currentPage} exitoso.`, status: "paged" });
            } else if (pageResult.status === "dots") {
              socket.emit("status", { message: `Navegando a través de salto de página para llegar a ${currentPage}...`, status: "paging_dots" });
              await page.waitForTimeout(6000);
              await page.waitForLoadState('networkidle');
              // No marcamos como clicked, permitimos que el bucle WHILE reintente encontrar el número ahora visible
            } else {
              retries--;
              if (retries > 0) {
                socket.emit("status", { 
                  message: `⚠️ No se pudo navegar a la página ${currentPage}. Reintentando en 30 segundos... (Quedan ${retries} intentos)`, 
                  status: "warning" 
                });
                await page.waitForTimeout(30000);
              } else {
                socket.emit("status", { message: `❌ Fallaron todos los reintentos para la página ${currentPage}.`, status: "error" });
              }
            }
          }

          if (!clicked) break; 
        }

        // 2. Extracción de datos de la página actual
        const oficiosLinks: any[] = await page.evaluate(`(() => {
          const pnl = document.querySelector('[id$="pnlOficios"]');
          if (!pnl) return [];
          const containers = Array.from(pnl.querySelectorAll(".contenedor_votacion"));
          const res = [];
          for (let i = 0; i < containers.length; i++) {
            const container = containers[i];
            const link = container.querySelector(".campos_votacion .materia_votacion p a");
            
            let dateStr = "";
            const datosVotacion = container.querySelector(".datos_votacion");
            if (datosVotacion) {
              const textContent = datosVotacion.textContent || "";
              const parts = textContent.split("|");
              if (parts.length > 0) {
                dateStr = parts[0].trim();
              }
            }

            if (link) {
              res.push({ 
                href: link.getAttribute('href'), 
                text: link.textContent ? link.textContent.trim() : "",
                dateRaw: dateStr
              });
            }
          }
          return res;
        })()`);

        // Filtrar por fecha >= 11 de Marzo de 2026
        const targetDate = new Date(2026, 2, 11);
        let reachedOldItems = false;

        const filteredLinks = oficiosLinks.filter(l => {
          const itemDate = parseCamaraDate(l.dateRaw);
          if (!itemDate) return true; // Si no hay fecha, procesar por si acaso
          
          if (itemDate < targetDate) {
            reachedOldItems = true;
            return false;
          }
          return true;
        });

        totalValidForDiputado += filteredLinks.length;
        if (db) {
            await db.collection("SearchStatus").updateOne(
                { diputado: diputado.text },
                { $set: { validLinksFound: totalValidForDiputado, updatedAt: new Date() } }
            );
        }

        socket.emit("status", { 
          message: `Recopilados ${filteredLinks.length} enlaces válidos (de ${oficiosLinks.length}) en pág ${currentPage}.`, 
          status: "collecting" 
        });

        const linksToStore = filteredLinks.map(l => ({
          diputado: diputado.text,
          href: l.href,
          text: l.text,
          status: 'pending',
          scrapedAt: new Date()
        }));

        for (const link of linksToStore) {
          if (db) {
            await db.collection("PendingLinks").updateOne(
              { href: link.href },
              { $set: link },
              { upsert: true }
            );
          } else {
            const index = pendingLinks.findIndex(p => p.href === link.href);
            if (index > -1) pendingLinks[index] = link;
            else pendingLinks.push(link);
          }
        }
        
        socket.emit("pending_links_found", linksToStore);
        
        if (reachedOldItems) {
            socket.emit("status", { message: "Detectada fecha anterior al 11/03/2026. Finalizando búsqueda para este diputado.", status: "completed_early" });
            break;
        }

        await page.waitForTimeout(1000);
      }

      // Marcar como completado tras recorrer todas las páginas o llegar al límite de fecha
      if (db) {
        await db.collection("SearchStatus").updateOne(
          { diputado: diputado.text },
          { $set: { status: "completed", validLinksFound: totalValidForDiputado, updatedAt: new Date() } }
        );
      }

    }

    socket.emit("status", { message: "Fase de recolección de enlaces finalizada.", status: "completed" });

  } catch (error: any) {
    console.error("Scraper Error:", error);
    socket.emit("status", { message: `Error fatal: ${error.message}`, status: "error" });
  } finally {
    if (browser) await browser.close();
  }
}

async function runDetailRevision(socketId: string) {
  const socket = io.to(socketId);
  socket.emit("status", { message: "Iniciando revisión de detalles...", status: "starting_revision" });

  let browser: Browser | null = null;
  try {
    const linksToProcess = db 
      ? await db.collection("PendingLinks").find({ status: 'pending' }).toArray()
      : pendingLinks.filter(l => l.status === 'pending');

    if (linksToProcess.length === 0) {
      socket.emit("status", { message: "No hay enlaces pendientes de revisión.", status: "completed" });
      return;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    for (const linkObj of linksToProcess) {
      const detailUrl = linkObj.href.startsWith('http') ? linkObj.href : `https://www.camara.cl/fiscalizacion/oficios_fiscalizacion/${linkObj.href}`;
      
      socket.emit("status", { 
        message: `Revisando Detalle (${linksToProcess.indexOf(linkObj) + 1}/${linksToProcess.length}): ${linkObj.text.substring(0, 30)}...`, 
        status: "extracting_detail" 
      });

      const detailPage = await context.newPage();
      try {
        await detailPage.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await detailPage.waitForSelector("#info-ficha", { timeout: 10000 });

        const detailData: any = await detailPage.evaluate(`(() => {
          const infoFicha = document.querySelector("#info-ficha");
          if (!infoFicha) return null;

          const data = {
            numeroOficio: "",
            fecha: "",
            destino: "",
            materia: ""
          };

          const divs = infoFicha.querySelectorAll(".datos-ficha");
          for (let i = 0; i < divs.length; i++) {
            const d = divs[i];
            const labelEl = d.querySelector(".dato");
            const infoEl = d.querySelector(".info");
            if (labelEl && infoEl) {
              const labelText = labelEl.textContent || "";
              const valueText = infoEl.textContent ? infoEl.textContent.trim() : "";
              
              if (labelText.indexOf("Oficio N°") !== -1) data.numeroOficio = valueText;
              else if (labelText.indexOf("Fecha") !== -1) data.fecha = valueText;
              else if (labelText.indexOf("Destino") !== -1) data.destino = valueText;
              else if (labelText.indexOf("Materia") !== -1) data.materia = valueText;
            }
          }

          const pdfEl = infoFicha.querySelector('a[id$="link_oficio"]');
          const pdfLink = pdfEl ? pdfEl.getAttribute('href') : "";
          
          return {
            numeroOficio: data.numeroOficio,
            fecha: data.fecha,
            destino: data.destino,
            materia: data.materia,
            pdfUrl: pdfLink ? "https://www.camara.cl" + pdfLink : ""
          };
        })()`);

        if (detailData) {
          const finalData = { ...linkObj, ...detailData, status: 'completed', finalizedAt: new Date() };
          
          if (db) {
            // Upsert: Actualizar si ya existe por numeroOficio, de lo contrario crear
            await db.collection("Oficios").updateOne(
              { numeroOficio: detailData.numeroOficio },
              { $set: finalData },
              { upsert: true }
            );
            await db.collection("PendingLinks").updateOne({ href: linkObj.href }, { $set: { status: 'completed' } });
          } else {
            const idx = inMemoryOficios.findIndex(o => o.numeroOficio === detailData.numeroOficio);
            if (idx > -1) inMemoryOficios[idx] = finalData;
            else inMemoryOficios = [finalData, ...inMemoryOficios].slice(0, 500);
            
            linkObj.status = 'completed';
          }

          socket.emit("data_rows", [finalData]);
        }
      } catch (e) {
        console.error("Error en detalle:", e);
      } finally {
        await detailPage.close();
      }

      // ESPERA DE 10 SEGUNDOS SEGUN SOLICITUD
      socket.emit("status", { message: "Esperando 10 segundos para evitar bloqueo...", status: "waiting_10s" });
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    socket.emit("status", { message: "Revisión de detalles finalizada.", status: "completed" });

  } catch (error: any) {
    socket.emit("status", { message: `Error en revisión: ${error.message}`, status: "error" });
  } finally {
    if (browser) await browser.close();
  }
}

// API Routes
app.get("/api/pending-links", async (req, res) => {
  if (db) {
    const links = await db.collection("PendingLinks").find({ status: 'pending' }).toArray();
    return res.json(links);
  }
  res.json(pendingLinks.filter(l => l.status === 'pending'));
});

app.post("/api/clear/local", (req, res) => {
  inMemoryOficios = [];
  pendingLinks = [];
  res.json({ message: "Memoria local limpiada." });
});

app.post("/api/clear/db", async (req, res) => {
  // Siempre limpiamos la memoria local por si acaso
  inMemoryOficios = [];
  pendingLinks = [];
  
  if (db) {
    try {
      await db.collection("Oficios").deleteMany({});
      await db.collection("PendingLinks").deleteMany({});
      await db.collection("SearchStatus").deleteMany({});
      return res.json({ message: "Base de datos y memoria local limpiadas." });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  // Si no hay DB, al menos limpiamos lo local y avisamos
  res.json({ message: "Memoria local limpiada (Base de datos no conectada)." });
});

// API Routes
app.get("/api/known-diputados", async (req, res) => {
  if (db) {
    try {
      const docs = await db.collection("SearchStatus").find({}, { projection: { diputado: 1, _id: 0 } }).toArray();
      const names = docs.map(d => d.diputado);
      return res.json(names);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.json([]);
});

app.get("/api/search-status", async (req, res) => {
  if (db) {
    try {
      const stats = await db.collection("SearchStatus").find({}).toArray();
      return res.json(stats);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.json([]);
});

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

  socket.on("start_scraping", (data?: { selectedNames?: string[] }) => {
    runScraper(socket.id, data?.selectedNames);
  });

  socket.on("start_revision", () => {
    runDetailRevision(socket.id);
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
