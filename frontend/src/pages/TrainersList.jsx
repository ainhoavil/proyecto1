import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../helpers/http";
import "../styles/trainers-list.scss";

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export default function TrainersList() {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

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

  const filtered = useMemo(() => {
    const query = normalize(q).trim();
    if (!query) return trainers;

    return trainers.filter((t) => {
      const haystack = normalize(
        [
          t.displayName,
          t.bio,
          (t.specialties || []).join(" "),
        ].join(" ")
      );
      return haystack.includes(query);
    });
  }, [trainers, q]);

  if (loading) return <p>Cargando adiestradores…</p>;
  if (error) return <p>{error}</p>;

  return (
    <div className="trainers-list">
      <div className="trainers-list__head">
        <div>
          <h1>Adiestradores</h1>
          <p className="trainers-list__subtitle">
            Conoce a nuestro equipo y elige el profesional que mejor encaje con tu perro.
          </p>
        </div>

        <div className="trainers-list__search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, especialidad o descripción…"
            aria-label="Buscar adiestradores"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="trainers-list__empty">
          <p>No hay resultados con ese filtro.</p>
        </div>
      ) : (
        <div className="trainers-list__grid">
          {filtered.map((t) => {
            const bio = String(t.bio || "").trim();

            const years =
              t.experienceYears === null || t.experienceYears === undefined
                ? null
                : Number(t.experienceYears);

            const yearsText =
              years === null || Number.isNaN(years)
                ? ""
                : `${years} ${years === 1 ? "año" : "años"} de experiencia`;

            const specialties = Array.isArray(t.specialties) ? t.specialties : [];

            return (
              <article key={t.trainerId} className="trainers-list__card">
                <Link
                  to={`/adiestradores/${t.trainerId}`}
                  className="trainers-list__cardLink"
                >
                  <div className="trainers-list__photo">
                    {t.photoUrl ? (
                      <img src={t.photoUrl} alt={t.displayName} />
                    ) : (
                      <div className="trainers-list__placeholder">Sin foto</div>
                    )}
                  </div>

                  <div className="trainers-list__content">
                    <div className="trainers-list__top">
                      <h3 className="trainers-list__name">{t.displayName}</h3>

                      {yearsText && (
                        <span className="trainers-list__pill">{yearsText}</span>
                      )}
                    </div>

                    {bio ? (
                      <p className="trainers-list__bio">{bio}</p>
                    ) : (
                      <p className="trainers-list__muted">
                        Este adiestrador aún no ha añadido una descripción.
                      </p>
                    )}

                    {specialties.length > 0 && (
                      <div className="trainers-list__chips">
                        {specialties.slice(0, 4).map((s, i) => (
                          <span key={i} className="trainers-list__chip">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="trainers-list__ctaRow">
                      <span className="trainers-list__cta">Ver perfil</span>
                    </div>
                  </div>
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
