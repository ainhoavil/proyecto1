// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { http } from "../helpers/http";

const absUrl = (u = "") => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return u.replace(/^\/+/, "");
};

export default function TrainerPublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [trainer, setTrainer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadTrainer = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await http(`/api/trainers/${id}/profile`);
        setTrainer(data);
      } catch {
        setError("No se pudo cargar el perfil del adiestrador.");
      } finally {
        setLoading(false);
      }
    };

    loadTrainer();
  }, [id]);

  const nombre = useMemo(() => {
    if (!trainer) return "";
    return trainer.displayName || trainer.email || `Adiestrador ${id}`;
  }, [trainer, id]);

  const yearsText = useMemo(() => {
    const y = trainer?.experienceYears;
    if (y === null || y === undefined || Number.isNaN(Number(y))) return "";
    const n = Number(y);
    return `${n} ${n === 1 ? "año" : "años"} de experiencia`;
  }, [trainer]);

  const specialties =
    Array.isArray(trainer?.specialties) ? trainer.specialties : [];

  const bio = String(trainer?.bio || "").trim();
  const dogs = Array.isArray(trainer?.workDogs) ? trainer.workDogs : [];

  const handleContratar = () => {
    navigate(`/contratar?trainerId=${id}`);
  };

  if (loading) {
    return (
      <div className="trainer-public">
        <p className="trainer-public__state">Cargando perfil…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trainer-public">
        <p className="trainer-public__state trainer-public__state--error">
          {error}
        </p>
      </div>
    );
  }

  if (!trainer) {
    return (
      <div className="trainer-public">
        <p className="trainer-public__state">Perfil no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="trainer-public">
      <div className="trainer-public__card">
        <header className="trainer-public__header">
          <div className="trainer-public__photo">
            {trainer.photoUrl ? (
              <img src={trainer.photoUrl} alt={nombre} />
            ) : (
              <div className="trainer-public__photoPlaceholder">Sin foto</div>
            )}
          </div>

          <div className="trainer-public__headline">
            <h1 className="trainer-public__name">{nombre}</h1>

            {yearsText && (
              <div className="trainer-public__meta">
                <span className="trainer-public__pill">{yearsText}</span>
              </div>
            )}

            <div className="trainer-public__actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleContratar}
              >
                Reservar con este adiestrador
              </button>
            </div>
          </div>
        </header>

        <section className="trainer-public__body">
          <div className="trainer-public__section">
            <h2 className="trainer-public__sectionTitle">Sobre el adiestrador</h2>
            {bio ? (
              <p className="trainer-public__bio">{bio}</p>
            ) : (
              <p className="trainer-public__muted">
                Este adiestrador aún no ha añadido una descripción.
              </p>
            )}
          </div>

          <div className="trainer-public__section">
            <h2 className="trainer-public__sectionTitle">Perros de trabajo</h2>

            {dogs.length > 0 ? (
              <div className="trainer-public__dogs">
                {dogs.map((d) => (
                  <div key={d.id} className="trainer-public__dogCard">
                    <div className="trainer-public__dogAvatar">
                      {d.avatarUrl ? (
                        <img src={absUrl(d.avatarUrl)} alt={d.nombre || "Perro"} />
                      ) : (
                        <span>
                          {String(d.nombre || "?")
                            .trim()
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="trainer-public__dogInfo">
                      <div className="trainer-public__dogName">{d.nombre}</div>
                      {d.raza ? (
                        <div className="trainer-public__dogBreed">{d.raza}</div>
                      ) : (
                        <div className="trainer-public__dogBreed trainer-public__muted">
                          Sin raza indicada
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="trainer-public__muted">
                No hay perros de trabajo registrados.
              </p>
            )}
          </div>
          <div className="trainer-public__section">
            <h2 className="trainer-public__sectionTitle">Especialidades</h2>

            {specialties.length > 0 ? (
              <div className="trainer-public__chips">
                {specialties.map((s, i) => (
                  <span key={i} className="trainer-public__chip">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="trainer-public__muted">
                No hay especialidades registradas.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
