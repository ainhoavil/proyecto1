import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../helpers/http";
import "../styles/trainers-list.scss";

export default function TrainersList() {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await http("/api/trainers/public");
        setTrainers(Array.isArray(data) ? data : []);
      } catch {
        setError("No se pudieron cargar los adiestradores.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <p>Cargando adiestradores…</p>;
  if (error) return <p>{error}</p>;

  return (
    <div className="trainers-list">
      <h1>Adiestradores</h1>

      <div className="grid">
        {trainers.map((t) => (
          <Link
            key={t.trainerId}
            to={`/adiestradores/${t.trainerId}`}
            className="trainer-card"
          >
            <div className="photo">
              {t.photoUrl ? (
                <img src={t.photoUrl} alt={t.displayName} />
              ) : (
                <div className="placeholder">Sin foto</div>
              )}
            </div>

            <h3>{t.displayName}</h3>

            {t.experienceYears != null && (
              <p className="experience">
                {t.experienceYears} años de experiencia
              </p>
            )}

            {t.specialties.length > 0 && (
              <div className="specialties">
                {t.specialties.slice(0, 3).map((s, i) => (
                  <span key={i}>{s}</span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
