import "../styles/legal.scss";

export default function PoliticaPrivacidad() {
  return (
    <div className="df-legal">
      <header className="df-legal__hero">
        <p className="df-legal__eyebrow">Privacidad</p>
        <h1 className="df-legal__title">Política de Privacidad</h1>
        <p className="df-legal__subtitle">
          Información sobre el tratamiento de datos personales conforme a la normativa aplicable.
        </p>

        <div className="df-legal__meta">
          <span>Última actualización: 03/01/2026</span>
          <span>Documento orientativo (ajusta finalidades, bases legales y proveedores)</span>
        </div>

        <nav className="df-legal__toc" aria-label="Índice Política de Privacidad">
          <a href="#responsable">Responsable</a>
          <a href="#datos">Datos tratados</a>
          <a href="#finalidades">Finalidades</a>
          <a href="#base-legal">Base legal</a>
          <a href="#destinatarios">Destinatarios</a>
          <a href="#derechos">Derechos</a>
          <a href="#seguridad">Seguridad</a>
          <a href="#contacto-priv">Contacto</a>
        </nav>
      </header>

      <div className="df-legal__grid">
        <section id="responsable" className="df-legal__card">
          <h2>1. Responsable del tratamiento</h2>
          <p>
            El responsable del tratamiento de los datos personales recabados a través del Sitio es:
          </p>
          <ul>
            <li><strong>Titular:</strong> DogForm (RELLENAR razón social)</li>
            <li><strong>NIF/CIF:</strong> RELLENAR</li>
            <li><strong>Domicilio:</strong> RELLENAR</li>
            <li>
              <strong>Correo de privacidad:</strong>{" "}
              <a href="mailto:privacidad@dogform.es">privacidad@dogform.es</a>
            </li>
          </ul>
        </section>

        <section id="datos" className="df-legal__card">
          <h2>2. Qué datos podemos tratar</h2>
          <p>
            En función del uso que hagas del Sitio, podemos tratar, entre otros, los siguientes tipos
            de datos:
          </p>
          <ul>
            <li><strong>Identificativos:</strong> nombre, apellidos, usuario.</li>
            <li><strong>Contacto:</strong> correo electrónico, teléfono (si se solicita).</li>
            <li><strong>Cuenta y acceso:</strong> credenciales y registros de autenticación.</li>
            <li><strong>Servicio:</strong> reservas, historial de servicios, comunicaciones de soporte o chat.</li>
            <li><strong>Técnicos:</strong> IP, logs, identificadores del dispositivo (según configuración y hosting).</li>
          </ul>
        </section>

        <section id="finalidades" className="df-legal__card">
          <h2>3. Finalidades del tratamiento</h2>
          <p>Tratamos los datos personales para:</p>
          <ul>
            <li>Gestionar el alta y administración de tu cuenta.</li>
            <li>Tramitar la contratación de servicios, reservas y comunicaciones asociadas.</li>
            <li>Atender solicitudes enviadas mediante formularios o canales de contacto.</li>
            <li>Gestionar el soporte, incidencias y comunicaciones operativas.</li>
            <li>Mejorar el Sitio y garantizar su seguridad (prevención de fraude/abuso).</li>
          </ul>
        </section>

        <section id="base-legal" className="df-legal__card">
          <h2>4. Base jurídica</h2>
          <p>
            Las bases legales que pueden aplicar, según el caso, son:
          </p>
          <ul>
            <li><strong>Ejecución de un contrato</strong> (gestión de cuenta, reservas y servicios).</li>
            <li><strong>Consentimiento</strong> (por ejemplo, solicitudes de contacto y ciertas comunicaciones).</li>
            <li><strong>Interés legítimo</strong> (seguridad, prevención de abusos, mejoras del servicio).</li>
            <li><strong>Obligación legal</strong> (cuando proceda por normativa aplicable).</li>
          </ul>
        </section>

        <section id="destinatarios" className="df-legal__card">
          <h2>5. Destinatarios y encargados</h2>
          <p>
            Con carácter general, no se cederán datos a terceros, salvo obligación legal o cuando sea
            necesario para prestar el servicio mediante proveedores (por ejemplo: hosting, correo,
            infraestructura, almacenamiento o analítica, si la hubiera).
          </p>
          <p>
            Si se utilizan proveedores que traten datos por cuenta del Titular, se formalizarán los
            acuerdos de encargo correspondientes y, en su caso, se adoptarán garantías adicionales
            para transferencias internacionales.
          </p>
        </section>

        <section id="derechos" className="df-legal__card">
          <h2>6. Derechos de las personas usuarias</h2>
          <p>
            Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y
            portabilidad, cuando proceda, enviando una solicitud a{" "}
            <a href="mailto:privacidad@dogform.es">privacidad@dogform.es</a>.
          </p>
          <p>
            También puedes presentar una reclamación ante la autoridad de control competente (AEPD)
            si consideras que el tratamiento no se ajusta a la normativa.
          </p>
        </section>

        <section id="seguridad" className="df-legal__card">
          <h2>7. Medidas de seguridad</h2>
          <p>
            Se aplican medidas técnicas y organizativas razonables para proteger los datos personales
            y evitar su alteración, pérdida, tratamiento o acceso no autorizado, teniendo en cuenta
            el estado de la técnica, la naturaleza de los datos y los riesgos asociados.
          </p>
        </section>

        <section id="contacto-priv" className="df-legal__card">
          <h2>8. Contacto</h2>
          <p>
            Si tienes dudas sobre esta Política de Privacidad, contacta en{" "}
            <a href="mailto:privacidad@dogform.es">privacidad@dogform.es</a>.
          </p>

          <div className="df-legal__note">
            Importante: ajusta este texto a tu caso real (qué datos recoges, qué emails envías,
            qué proveedores usas, plazos de conservación, etc.). Si tu proyecto se publica, conviene
            revisarlo con alguien especializado.
          </div>
        </section>
      </div>
    </div>
  );
}
