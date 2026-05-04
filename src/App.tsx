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
import { play, stop, refresh, download } from "ionicons/icons";
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

    socket.on("data_rows", (rows: Oficio[]) => {
      setResults(prev => [...rows, ...prev]);
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
      const response = await axios.get("/api/oficios");
      if (Array.isArray(response.data)) {
        setResults(response.data);
      } else {
        setResults([]);
      }
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
      socket.emit("start_scraping");
    }
  };

  return (
    <IonApp>
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <div className="header-container">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: '#2563eb', padding: '6px', borderRadius: '8px', display: 'flex' }}>
                  <IonIcon icon={play} style={{ color: 'white' }} />
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
                <div className="info-tile-label">Resultados</div>
                <div className="info-tile-value" style={{ fontSize: '20px', fontWeight: 800 }}>{results.length.toLocaleString()}</div>
              </div>
              <div className="info-tile" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IonButton 
                  mode="ios"
                  color="primary"
                  onClick={startScraping} 
                  disabled={status.status !== "idle" && status.status !== "completed" && status.status !== "error"}
                >
                  <IonIcon icon={play} slot="start" />
                  Iniciar
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
                      <IonButton fill="clear" size="small" onClick={fetchData}>
                        <IonIcon icon={refresh} />
                      </IonButton>
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
                                    background: r.estado.includes('Enviado') ? '#ecfdf5' : '#fef2f2', 
                                    color: r.estado.includes('Enviado') ? '#047857' : '#b91c1c',
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
