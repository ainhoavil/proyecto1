import { useState } from 'react';

function Contacto() {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [enviado, setEnviado] = useState(false);

  const manejarEnvio = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:5000/contacto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, mensaje }),
      });
  
      if (res.ok) {
        setEnviado(true);
        setNombre('');
        setEmail('');
        setMensaje('');
      } else {
        console.error('Error al enviar el mensaje');
      }
    } catch (err) {
      console.error('Error de red:', err);
    }
  };
  
  return (
    <div className="contacto">
      <h1>Contacto</h1>
      <form onSubmit={manejarEnvio}>
        <label>
          Nombre:
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </label>
        <label>
          Correo electrónico:
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Mensaje:
          <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} required />
        </label>
        <button type="submit">Enviar</button>
      </form>
      {enviado && <p>Gracias por contactarnos. Te responderemos pronto.</p>}
    </div>
  );
}

export default Contacto;