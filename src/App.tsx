import React, { useState, useEffect, useRef } from "react";
import {
  IonApp,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonSpinner,
  setupIonicReact
} from "@ionic/react";
import {
  Trash2,
  Database,
  Play,
  RefreshCw,
  Download,
  Terminal
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import axios from "axios";

/* Basic setup for Ionic React */
setupIonicReact();

interface Oficio {
  diputado: string;
  numeroOficio: string;
  fecha: string;
  materia: string;
  institucion: string;
  estado: string;
}

interface Status {
  message: string;
  status: string;
  page?: number;
  currentDiputado?: string;
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>({ message: "Listo para iniciar", status: "idle" });
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<Oficio[]>([]);
  const [pendingLinks, setPendingLinks] = useState<any[]>([]);
  const [searchStatus, setSearchStatus] = useState<any[]>([]);
  const [knownDiputados, setKnownDiputados] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [screenshot, setScreenshot] = useState<{ image: string, step: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Connect to socket
    const newSocket = io();
    setSocket(newSocket);

    // Initial load
    fetchData();

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on("status", (data: Status) => {
      setStatus(data);
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${data.message}`]);
    });

    socket.on("screenshot", (data: { image: string, step: string }) => {
      setScreenshot(data);
    });

    socket.on("export_json", (payload: { filename: string, data: any[] }) => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload.data, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", payload.filename);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - 📥 Archivo generado: ${payload.filename}`]);
    });

    socket.on("data_rows", (rows: Oficio[]) => {
      setResults(prev => [...rows, ...prev]);
    });

    socket.on("pending_links_found", (links: any[]) => {
      setPendingLinks(prev => [...links, ...prev]);
    });

    return () => {
      socket.off("status");
      socket.off("screenshot");
      socket.off("data_rows");
    };
  }, [socket]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const resp1 = await axios.get("/api/oficios");
      setResults(Array.isArray(resp1.data) ? resp1.data : []);
      
      const resp2 = await axios.get("/api/pending-links");
      setPendingLinks(Array.isArray(resp2.data) ? resp2.data : []);

      const resp3 = await axios.get("/api/search-status");
      setSearchStatus(Array.isArray(resp3.data) ? resp3.data : []);

      const resp4 = await axios.get("/api/known-diputados");
      setKnownDiputados(Array.isArray(resp4.data) ? resp4.data : []);
    } catch (err) {
      console.error("Error fetching data:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const startScraping = () => {
    if (socket) {
      setLogs([]);
      setResults([]);
      socket.emit("start_scraping", { selectedNames });
    }
  };

  const startRevision = () => {
    if (socket) {
      socket.emit("start_revision");
    }
  };

  const exportToJSON = (data: any[], name: string) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${name}_${new Date().getTime()}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const clearLocal = async () => {
    try {
      await axios.post("/api/clear/local");
      setResults([]);
      setPendingLinks([]);
      setSearchStatus([]);
      setStatus({ message: "Memoria local limpiada", status: "idle" });
    } catch (err) {
      console.error(err);
    }
  };

  const clearDatabase = async () => {
    if (!window.confirm("¿Estás seguro de borrar TODA la base de datos?")) return;
    try {
      await axios.post("/api/clear/db");
      setResults([]);
      setPendingLinks([]);
      setSearchStatus([]);
      setStatus({ message: "Base de datos borrada", status: "idle" });
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSelection = (name: string) => {
    setSelectedNames(prev => 
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  return (
    <IonApp>
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <div className="header-container">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: '#2563eb', padding: '6px', borderRadius: '8px', display: 'flex' }}>
                  <Play size={16} color="white" />
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Fiscalización Tracker</h1>
                  <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Monitor de Oficios • v2.1.0
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className={`status-dot ${status.status !== 'idle' && status.status !== 'completed' ? 'animate-pulse' : ''}`} />
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>Status: </span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#10b981' }}>{status.status.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </IonToolbar>
        </IonHeader>

        <IonContent>
          <div className="ion-padding">
            <div className="control-grid">
              <div className="info-tile" style={{ gridColumn: 'span 2' }}>
                <div className="info-tile-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Personas Seleccionadas ({selectedNames.length})</span>
                  <IonButton 
                    fill="clear" 
                    size="small" 
                    style={{ margin: 0, height: '14px', fontSize: '10px' }}
                    onClick={() => setSelectedNames(prev => prev.length === knownDiputados.length ? [] : [...knownDiputados])}
                  >
                    {selectedNames.length === knownDiputados.length ? "Deseleccionar Todos" : "Seleccionar Todos Detectados"}
                  </IonButton>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '120px', overflowY: 'auto', padding: '8px 0' }}>
                  {knownDiputados.length === 0 ? (
                    <span style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
                      No se han detectado personas aún. Inicia la recolección para verlas aquí.
                    </span>
                  ) : (
                    knownDiputados.map(name => (
                      <div 
                        key={name}
                        onClick={() => toggleSelection(name)}
                        style={{
                          fontSize: '10px',
                          padding: '4px 8px',
                          borderRadius: '99px',
                          cursor: 'pointer',
                          background: selectedNames.includes(name) ? '#2563eb' : '#f1f5f9',
                          color: selectedNames.includes(name) ? '#fff' : '#475569',
                          transition: 'all 0.2s',
                          border: '1px solid',
                          borderColor: selectedNames.includes(name) ? '#1e40af' : '#e2e8f0',
                          fontWeight: 600
                        }}
                      >
                        {name}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="info-tile">
                <div className="info-tile-label">Filtro Activo</div>
                <div className="info-tile-value">
                  <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', marginRight: '6px' }}>DIPUTADO</span>
                  Visible
                </div>
              </div>
              <div className="info-tile">
                <div className="info-tile-label">Objetivo Actual</div>
                <div className="info-tile-value">{status.currentDiputado || "Ninguno"}</div>
              </div>
              <div className="info-tile">
                <div className="info-tile-label">Enlaces en Cola</div>
                <div className="info-tile-value" style={{ fontSize: '20px', fontWeight: 800, color: '#f59e0b' }}>{pendingLinks.length}</div>
              </div>
              <div className="info-tile">
                <div className="info-tile-label">Personas Listas</div>
                <div className="info-tile-value" style={{ fontSize: '20px', fontWeight: 800, color: '#10b981' }}>
                  {searchStatus.filter(s => s.status === 'completed').length}
                </div>
              </div>
              <div className="info-tile">
                <div className="info-tile-label">Datos de Fiscalización</div>
                <div className="info-tile-value" style={{ fontSize: '20px', fontWeight: 800, color: '#2563eb' }}>{results.length}</div>
              </div>
              <div className="info-tile" style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
                <IonButton 
                  mode="ios"
                  color="primary"
                  size="small"
                  expand="block"
                  onClick={startScraping} 
                  disabled={status.status === "scraping" || status.status === "starting"}
                >
                  <Play size={14} style={{ marginRight: '8px' }} />
                  Recolectar Enlaces
                </IonButton>
                <IonButton 
                  mode="ios"
                  color="warning"
                  size="small"
                  expand="block"
                  onClick={startRevision} 
                  disabled={pendingLinks.length === 0 || status.status === "starting_revision"}
                >
                  <RefreshCw size={14} style={{ marginRight: '8px' }} />
                  Iniciar Revisión
                </IonButton>
              </div>
              <div className="info-tile" style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
                <IonButton 
                  mode="ios"
                  color="danger"
                  fill="outline"
                  size="small"
                  expand="block"
                  onClick={clearLocal}
                >
                  <Trash2 size={14} style={{ marginRight: '8px' }} />
                  Limpiar Local
                </IonButton>
                <IonButton 
                  mode="ios"
                  color="danger"
                  size="small"
                  expand="block"
                  onClick={clearDatabase}
                >
                  <Database size={14} style={{ marginRight: '8px' }} />
                  Borrar Base Datos
                </IonButton>
              </div>
            </div>

            {screenshot && (
              <div style={{ marginBottom: '24px' }}>
                <div className="info-tile-label">Vista en Tiempo Real: {screenshot.step}</div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', background: '#000', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                  <img 
                    src={`data:image/jpeg;base64,${screenshot.image}`} 
                    style={{ width: '100%', display: 'block' }} 
                    alt="Live Scraper View" 
                  />
                </div>
              </div>
            )}

            <IonGrid fixed={false}>
              <IonRow>
                <IonCol size="12">
                  <div className="results-card">
                    <div style={{ padding: '16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Live Stream: Datos de Fiscalización</h3>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <IonButton 
                          fill="clear" 
                          size="small" 
                          onClick={() => exportToJSON(results, 'Oficios_Completo')}
                          disabled={results.length === 0}
                        >
                          <Download size={14} style={{ marginRight: '4px' }} />
                          Exportar
                        </IonButton>
                        <IonButton fill="clear" size="small" onClick={fetchData}>
                          <RefreshCw size={14} />
                        </IonButton>
                      </div>
                    </div>

                    {loading && results.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px' }}>
                        <IonSpinner name="crescent" color="primary" />
                        <p style={{ color: '#64748b' }}>Sincronizando base de datos...</p>
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="results-table">
                          <thead>
                            <tr>
                              <th>Diputado</th>
                              <th>Oficio #</th>
                              <th>Fecha</th>
                              <th>Materia / Asunto</th>
                              <th>Institución</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.map((r, i) => (
                              <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{r.diputado}</td>
                                <td><span className="oficio-tag">{r.numeroOficio}</span></td>
                                <td style={{ color: '#64748b' }}>{r.fecha}</td>
                                <td className="materia-cell" title={r.materia}>{r.materia}</td>
                                <td>{r.institucion}</td>
                                <td>
                                  <span style={{ 
                                    background: (r.estado || '').includes('Enviado') ? '#ecfdf5' : '#fef2f2', 
                                    color: (r.estado || '').includes('Enviado') ? '#047857' : '#b91c1c',
                                    padding: '2px 8px',
                                    borderRadius: '99px',
                                    fontSize: '10px',
                                    fontWeight: 700
                                  }}>
                                    {r.estado}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </IonCol>
              </IonRow>
            </IonGrid>
          </div>
        </IonContent>

        <footer className="console-footer">
          <div className="console-header">
            <span>CONSOLE LOG - RUNTIME STREAM</span>
            <span>AUTO-SCROLL: ON</span>
          </div>
          <div className="log-stream">
            {logs.map((log, index) => (
              <div key={index}>
                <span style={{ color: '#64748b' }}>[{new Date().toLocaleTimeString()}]</span> {log.split(' - ')[1]}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </footer>
      </IonPage>
    </IonApp>
  );
};

export default App;
