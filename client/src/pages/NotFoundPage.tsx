import { Link } from 'react-router-dom';
import { Compass, Home, Radar } from 'lucide-react';
import { Card } from '@/components/ui';

export function NotFoundPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center p-6">
      <Card className="max-w-md p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Compass className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Off the chart</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          That route does not exist in the monitoring console. It may have been renamed, or the link you
          followed was malformed.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/dashboard" className="btn btn-primary btn-sm">
            <Home className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
          <Link to="/map" className="btn btn-secondary btn-sm">
            <Radar className="h-3.5 w-3.5" />
            Live map
          </Link>
        </div>
      </Card>
    </div>
  );
}
