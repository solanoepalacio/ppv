import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <p className="text-4xl font-bold text-text-primary">404</p>
      <p className="text-text-secondary">Page not found</p>
      <Link to="/" className="text-polka-400 hover:text-polka-300 text-sm">
        ← Back to Browse
      </Link>
    </div>
  );
}
