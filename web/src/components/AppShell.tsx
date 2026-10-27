import { AlertTriangle, Home, Leaf, Lock, LogOut, MapPin, Recycle, Sparkles, Truck } from 'lucide-react';
import type { Page } from '../types';

type ShellProps = {
  currentPage: Page;
  navigateTo: (page: Page) => void;
};

const publicNav = [
  { page: 'inicio' as Page, label: 'Início', shortLabel: 'Início', icon: Home },
  { page: 'coleta' as Page, label: 'Coleta', shortLabel: 'Coleta', icon: Truck },
  { page: 'zeladoria' as Page, label: 'Ocorrências', shortLabel: 'Relatar', icon: AlertTriangle },
  { page: 'ecopontos' as Page, label: 'EcoPontos', shortLabel: 'EcoPontos', icon: MapPin },
  { page: 'beneficios' as Page, label: 'Benefícios', shortLabel: 'Benefícios', icon: Sparkles }
];

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 font-extrabold tracking-tight ${inverse ? 'text-white' : 'text-eco-900'}`}>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${inverse ? 'bg-eco-600 text-white' : 'bg-eco-600 text-white'}`}>
        <Leaf className="h-5 w-5" />
      </span>
      <span>Eco<span className="text-eco-500">Recife</span></span>
    </span>
  );
}

export function PublicHeader({ currentPage, navigateTo }: ShellProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <button type="button" onClick={() => navigateTo('inicio')} aria-label="Ir para o início" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2">
          <Brand />
        </button>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navegação principal">
          {publicNav.map(item => {
            const active = currentPage === item.page;
            return (
              <button type="button" key={item.page} onClick={() => navigateTo(item.page)} aria-current={active ? 'page' : undefined} className={`relative rounded-lg px-3.5 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 ${active ? 'text-eco-700' : 'text-slate-600 hover:bg-slate-50 hover:text-eco-900'}`}>
                {item.label}
                {active && <span className="absolute inset-x-3 -bottom-2.5 h-0.5 rounded-full bg-eco-600" />}
              </button>
            );
          })}
        </nav>
        <button type="button" onClick={() => navigateTo('zeladoria')} className="hidden min-h-11 items-center gap-2 rounded-xl bg-eco-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2 sm:inline-flex">
          <AlertTriangle className="h-4 w-4" /> Relatar ocorrência
        </button>
        <div className="flex items-center gap-2 sm:hidden">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-eco-700">
            <span className="h-2 w-2 rounded-full bg-eco-500" /> Serviços ativos
          </span>
        </div>
      </div>
    </header>
  );
}

export function PublicMobileNav({ currentPage, navigateTo }: ShellProps) {
  return (
    <nav className="mobile-safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 pt-1.5 shadow-xl backdrop-blur-xl lg:hidden" aria-label="Navegação móvel">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {publicNav.map(item => {
          const active = currentPage === item.page;
          const Icon = item.icon;
          return (
            <button type="button" key={item.page} onClick={() => navigateTo(item.page)} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 ${active ? 'bg-emerald-50 text-eco-700' : 'text-slate-500'}`}>
              <Icon className="h-5 w-5" />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function PublicFooter({ navigateTo }: Pick<ShellProps, 'navigateTo'>) {
  return (
    <footer className="mb-16 border-t border-eco-800 bg-eco-900 py-10 text-white lg:mb-0">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Brand inverse />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-emerald-100/75">Serviços ambientais, informação de coleta e participação cidadã em um só lugar.</p>
          <p className="mt-4 text-xs font-semibold text-emerald-300">Protótipo acadêmico · Recife/PE</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Serviços</p>
          <div className="mt-3 grid gap-2 text-sm text-emerald-100">
            {publicNav.slice(1).map(item => <button type="button" key={item.page} onClick={() => navigateTo(item.page)} className="w-fit rounded text-left hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">{item.label}</button>)}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Acesso interno</p>
          <button type="button" onClick={() => navigateTo('login')} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-eco-700 bg-eco-800 px-4 text-sm font-bold text-white transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            <Lock className="h-4 w-4" /> Área da Gestão
          </button>
        </div>
      </div>
    </footer>
  );
}

export function ManagementHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-eco-800 bg-eco-900 text-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Brand inverse />
          <span className="hidden border-l border-eco-700 pl-4 text-sm font-semibold text-emerald-200 sm:block">Gestão operacional</span>
        </div>
        <button type="button" onClick={onExit} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-eco-800 px-3.5 text-sm font-bold text-white transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </header>
  );
}

export function LoginBrand() {
  return (
    <div className="mb-8 flex justify-center">
      <Brand />
    </div>
  );
}
