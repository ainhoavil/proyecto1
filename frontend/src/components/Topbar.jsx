import { useEffect, useState } from "react";
import { http } from "../helpers/http";

export default function TopBar() {
  const [data, setData] = useState({
    schedule: 'Horario: 9h a 21h de L a V, Sáb de 10h a 14h',
    email: 'info@dogform.com',
    phone: '612345678',
    social: { instagram: '', facebook: '' }
  });

  useEffect(() => {
    (async () => {
      try {
        const j = await http("/settings/topbar");
        setData(prev => ({
          ...prev,
          ...j,
          social: {
            instagram: j.social?.instagram || '',
            facebook: j.social?.facebook || ''
          }
        }));
      } catch (_) {
        /* Fallback silencioso */
      }
    })();
  }, []);

  return (
    <div className="topbar">
      <div className="container-top">
        <div className="left">
          <span>🕒 {data.schedule}</span>
          <span>📧 {data.email}</span>
          <span>📱 {data.phone}</span>
        </div>

        <div className="right">
          {data.social?.instagram && (
            <a href={data.social.instagram} target="_blank" rel="noreferrer">Instagram</a>
          )}
          {data.social?.facebook && (
            <a href={data.social.facebook} target="_blank" rel="noreferrer">Facebook</a>
          )}
        </div>
      </div>
    </div>
  );
}
