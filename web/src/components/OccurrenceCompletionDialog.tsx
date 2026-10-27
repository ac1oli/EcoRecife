import { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import type { Occurrence } from '../types';

type OccurrenceCompletionDialogProps = {
  occurrence: Occurrence | null;
  onCancel: () => void;
  onConfirm: (note: string) => void;
};

export function OccurrenceCompletionDialog({ occurrence, onCancel, onConfirm }: OccurrenceCompletionDialogProps) {
  const [note, setNote] = useState('');

  useEffect(() => {
    setNote('');
    if (!occurrence) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [occurrence, onCancel]);

  if (!occurrence) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="completion-title" className="fixed inset-0 z-[70] flex items-center justify-center bg-eco-900/60 p-4 backdrop-blur-sm" onMouseDown={onCancel}>
      <div className="w-full max-w-lg rounded-3xl border border-emerald-100 bg-white p-6 shadow-2xl sm:p-7" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-eco-700">
              <CheckCircle className="h-6 w-6" />
            </span>
            <div>
              <h2 id="completion-title" className="text-xl font-extrabold text-eco-900">Concluir ocorrência?</h2>
              <p className="mt-1 text-sm text-slate-500">{occurrence.protocol} · {occurrence.type}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fechar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-slate-600">A ocorrência sairá da fila ativa e ficará disponível no histórico. Essa ação registra o atendimento como concluído.</p>
        <label htmlFor="completion-note" className="mt-5 block text-sm font-bold text-eco-900">Observação da conclusão <span className="font-medium text-slate-400">(opcional)</span></label>
        <textarea
          id="completion-note"
          value={note}
          onChange={event => setNote(event.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Ex: Resíduos removidos e área limpa pela equipe."
          className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-eco-600 focus:ring-2 focus:ring-emerald-100"
        />
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600">Cancelar</button>
          <button type="button" onClick={() => onConfirm(note.trim())} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-eco-600 px-5 text-sm font-extrabold text-white transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2">
            <CheckCircle className="h-4 w-4" /> Confirmar conclusão
          </button>
        </div>
      </div>
    </div>
  );
}
