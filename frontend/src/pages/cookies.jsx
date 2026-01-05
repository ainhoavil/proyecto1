
export default function PoliticaCookies() {
  return (
    <div className="df-legal">
      <header className="df-legal__hero">
        <p className="df-legal__eyebrow">Legal</p>
        <h1 className="df-legal__title">Política de Cookies</h1>
        <p className="df-legal__subtitle">
          Esta política explica qué son las cookies, cuáles utilizamos y cómo puedes gestionarlas.
        </p>

        <div className="df-legal__meta">
          <span>Última actualización: 03/01/2026</span>
        </div>
      </header>

      <div className="df-legal__grid">
        <section className="df-legal__card">
          <h2>1. ¿Qué son las cookies?</h2>
          <p>
            Las cookies son pequeños archivos que se descargan en tu dispositivo al acceder a una
            página web. Permiten, entre otras cosas, almacenar y recuperar información sobre hábitos
            de navegación o preferencias, y pueden utilizarse para reconocer al usuario.
          </p>
        </section>

        <section className="df-legal__card">
          <h2>2. Tipos de cookies que se utilizan</h2>
          <p>
            En este sitio pueden utilizarse las siguientes categorías:
          </p>
          <ul>
            <li>
              <strong>Cookies necesarias:</strong> esenciales para el funcionamiento del sitio, la
              seguridad y la autenticación.
            </li>
            <li>
              <strong>Cookies de preferencias:</strong> recuerdan configuraciones como idioma, región
              o ajustes del usuario.
            </li>
            <li>
              <strong>Cookies de analítica:</strong> ayudan a medir y analizar el uso del sitio para
              mejorar su rendimiento.
            </li>
            <li>
              <strong>Cookies de marketing:</strong> permiten personalizar contenido y medir campañas
              (si procede).
            </li>
          </ul>
        </section>

        <section className="df-legal__card">
          <h2>3. Ejemplos habituales (orientativo)</h2>
          <p>
            Dependiendo de la configuración del sitio y de servicios de terceros, podrían existir
            cookies como:
          </p>
          <ul>
            <li><strong>Necesarias:</strong> sesión, autenticación, seguridad (por ejemplo, “session”).</li>
            <li><strong>Preferencias:</strong> idioma, tema, ajustes de UI (por ejemplo, “lang”).</li>
            <li><strong>Analítica:</strong> medición de visitas (por ejemplo, “_ga”, “_gid”, si se habilita analítica).</li>
            <li><strong>Marketing:</strong> medición/publicidad (por ejemplo, “_fbp”, si se habilita).</li>
          </ul>

          <div className="df-legal__note">
            Nota: lista orientativa. Ajusta esta sección a las cookies reales que uses (si usas analítica o marketing).
          </div>
        </section>

        <section className="df-legal__card">
          <h2>4. Cómo gestionar o desactivar cookies</h2>
          <p>
            Puedes aceptar, rechazar o configurar cookies desde el panel de preferencias del sitio.
            Además, tu navegador permite bloquear o eliminar cookies desde su configuración.
          </p>
        </section>
      </div>
    </div>
  );
}
