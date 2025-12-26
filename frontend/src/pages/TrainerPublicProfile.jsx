import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { http } from "../helpers/http";
import "../styles/trainer-public-profile.scss";

export default function TrainerPublicProfile() {
  const { id } = useParams();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await http(`/api/trainers/${id}/profile`);
        setProfile(data);
      } catch {
        setError("No se pudo cargar el perfil del adiestrador.");
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [id]);

  if (loading) {
    return <div className="trainer-public loading">Cargando perfil…</div>;
  }

  if (error) {
    return <div className="trainer-public error">{error}</div>;
  }

  if (!profile) {
    return <div className="trainer-public error">Perfil no encontrado.</div>;
  }

  return (
    <div className="trainer-public">
      <div className="trainer-card">
        <div className="trainer-photo">
          {profile.photoUrl ? (
            <img src={profile.photoUrl} alt={profile.displayName} />
          ) : (
            <div className="photo-placeholder">Sin foto</div>
          )}
        </div>

        <div className="trainer-info">
          <h1>{profile.displayName}</h1>

          {profile.experienceYears !== null && (
            <p className="experience">
              {profile.experienceYears} años de experiencia
            </p>
          )}

          {profile.bio && <p className="bio">{profile.bio}</p>}

          {profile.specialties?.length > 0 && (
            <div className="specialties">
              <h3>Especialidades</h3>
              <ul>
                {profile.specialties.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="cta">
            <Link to={`/contratar?trainerId=${profile.trainerId}`}>
              Reservar con este adiestrador
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
