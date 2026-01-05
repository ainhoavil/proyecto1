
export default function AvisoLegal() {
  return (
    <div className="df-legal">
      <header className="df-legal__hero">
        <p className="df-legal__eyebrow">Legal</p>
        <h1 className="df-legal__title">Aviso Legal</h1>
        <p className="df-legal__subtitle">
          Información general del sitio, condiciones de uso y aspectos legales aplicables.
        </p>

        <div className="df-legal__meta">
          <span>Última actualización: 03/01/2026</span>
          <span>Documento orientativo (rellena los datos reales del titular)</span>
        </div>

        <nav className="df-legal__toc" aria-label="Índice Aviso Legal">
          <a href="#identificacion">Identificación</a>
          <a href="#condiciones">Condiciones de uso</a>
          <a href="#propiedad">Propiedad intelectual</a>
          <a href="#responsabilidad">Responsabilidad</a>
          <a href="#jurisdiccion">Legislación</a>
          <a href="#contacto-legal">Contacto</a>
        </nav>
      </header>

      <div className="df-legal__grid">
        <section id="identificacion" className="df-legal__card">
          <h2>1. Datos identificativos</h2>
          <p>
            En cumplimiento con la normativa aplicable, se informa a los usuarios de que el presente
            sitio web y/o aplicación (en adelante, el “Sitio”) es titularidad de:
          </p>
          <ul>
            <li><strong>Titular:</strong> DogForm Adiestramiento canino</li>
            <li><strong>NIF/CIF:</strong> D31460454</li>
            <li><strong>Domicilio:</strong> C/ Gran Vía 25, 4ºB, 28013 Madrid</li>
            <li>
              <strong>Correo:</strong>{" "}
              <a href="mailto:legal@dogform.es">legal@dogform.es</a>{" "}
              (sustituye por el real)
            </li>
            <li><strong>Registro Mercantil:</strong> RELLENAR (si aplica)</li>
          </ul>
        </section>

        <section id="condiciones" className="df-legal__card">
          <h2>2. Condiciones de uso</h2>
          <p>
            El acceso y uso del Sitio atribuye la condición de usuario e implica la aceptación de
            las presentes condiciones. El usuario se compromete a hacer un uso diligente, lícito y
            responsable del Sitio, evitando cualquier actuación que pueda dañar, inutilizar o
            sobrecargar el servicio o impedir su normal utilización.
          </p>
          <p>
            El Titular se reserva el derecho a modificar, en cualquier momento y sin previo aviso,
            la presentación, configuración y contenidos del Sitio, así como estas condiciones.
          </p>
        </section>

        <section id="propiedad" className="df-legal__card">
          <h2>3. Propiedad intelectual e industrial</h2>
          <p>
            Salvo indicación expresa, los contenidos del Sitio (textos, imágenes, marcas, logos,
            diseño, código, etc.) están protegidos por derechos de propiedad intelectual e industrial
            y pertenecen al Titular o a terceros licenciantes.
          </p>
          <p>
            Queda prohibida la reproducción, distribución, comunicación pública o transformación,
            total o parcial, sin autorización previa y por escrito del Titular.
          </p>
        </section>

        <section id="responsabilidad" className="df-legal__card">
          <h2>4. Responsabilidad</h2>
          <p>
            El Titular no garantiza la inexistencia de interrupciones o errores en el acceso al
            Sitio, ni que su contenido esté permanentemente actualizado, aunque realizará esfuerzos
            razonables para evitarlo, corregirlo o actualizarlo, cuando proceda.
          </p>
          <p>
            El Titular no se responsabiliza del uso que los usuarios hagan de la información
            publicada ni de los daños que puedan derivarse del acceso o uso del Sitio, en la medida
            permitida por la normativa aplicable.
          </p>
        </section>

        <section id="jurisdiccion" className="df-legal__card">
          <h2>5. Legislación aplicable y jurisdicción</h2>
          <p>
            La relación entre el Titular y el usuario se regirá por la normativa española. Para la
            resolución de cualquier controversia, las partes se someterán a los juzgados y tribunales
            que correspondan conforme a derecho.
          </p>
        </section>

        <section id="contacto-legal" className="df-legal__card">
          <h2>6. Contacto</h2>
          <p>
            Para cualquier consulta relacionada con este Aviso Legal, puedes escribir a{" "}
            <a href="mailto:legal@dogform.es">legal@dogform.es</a>.
          </p>

          <div className="df-legal__note">
            Nota: si tu proyecto es real, sustituye los campos “RELLENAR” por datos verificados
            (razón social, NIF/CIF, domicilio, registro, etc.).
          </div>
        </section>
      </div>
    </div>
  );
}
