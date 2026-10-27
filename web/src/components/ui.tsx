import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageIntro({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <span className="text-xs font-extrabold uppercase tracking-widest text-eco-600">{eyebrow}</span>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-eco-900 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{description}</p>
      </div>
      {aside}
    </div>
  );
}

export function ServiceCard({ icon: Icon, title, description, action, tone = 'green', onClick }: { icon: LucideIcon; title: string; description: string; action: string; tone?: 'green' | 'blue' | 'amber'; onClick: () => void }) {
  const tones = {
    green: 'bg-emerald-50 text-eco-700 group-hover:bg-eco-600 group-hover:text-white',
    blue: 'bg-ecoblue-50 text-ecoblue-700 group-hover:bg-ecoblue-600 group-hover:text-white',
    amber: 'bg-amber-50 text-amber-700 group-hover:bg-amber-500 group-hover:text-white'
  };
  return (
    <button type="button" onClick={onClick} className="group flex min-h-52 flex-col rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2">
      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${tones[tone]}`}><Icon className="h-6 w-6" /></span>
      <h2 className="mt-5 text-xl font-extrabold text-eco-900">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{description}</p>
      <span className="mt-4 text-sm font-extrabold text-eco-700">{action} →</span>
    </button>
  );
}
