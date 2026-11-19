import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="rf-fullscreen">
      <div className="rf-fullscreen__box">
        <h1>404</h1>
        <p>Esta página no existe.</p>
        <Link to="/" className="rf-btn rf-btn--secondary">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
