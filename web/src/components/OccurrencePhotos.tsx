import { useEffect, useState } from 'react';
import { Image, X } from 'lucide-react';
import { getOccurrencePhotos } from '../lib/occurrencePhotoStorage';

type PhotoView = {
  id: string;
  name: string;
  url: string;
};

export function OccurrencePhotos({ occurrenceId }: { occurrenceId: number }) {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoView | null>(null);

  useEffect(() => {
    let active = true;
    let loadedPhotos: PhotoView[] = [];

    getOccurrencePhotos(occurrenceId)
      .then(records => {
        loadedPhotos = records.map(record => ({
          id: record.id,
          name: record.name,
          url: URL.createObjectURL(record.blob)
        }));
        if (active) setPhotos(loadedPhotos);
        else loadedPhotos.forEach(photo => URL.revokeObjectURL(photo.url));
      })
      .catch(() => {
        if (active) setPhotos([]);
      });

    return () => {
      active = false;
      loadedPhotos.forEach(photo => URL.revokeObjectURL(photo.url));
    };
  }, [occurrenceId]);

  useEffect(() => {
    if (!selectedPhoto) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPhoto(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedPhoto]);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500">
          <Image className="h-3.5 w-3.5" /> {photos.length} {photos.length === 1 ? 'imagem anexada' : 'imagens anexadas'}
        </p>
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <button
              type="button"
              key={photo.id}
              onClick={() => setSelectedPhoto(photo)}
              aria-label={`Ampliar imagem ${index + 1} da ocorrência`}
              className="overflow-hidden rounded-xl border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2"
            >
              <img src={photo.url} alt="" className="h-20 w-24 object-cover transition hover:scale-105" />
            </button>
          ))}
        </div>
      </div>

      {selectedPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Visualização da imagem da ocorrência"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-eco-900/90 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={event => event.stopPropagation()}>
            <img src={selectedPhoto.url} alt={selectedPhoto.name || 'Imagem da ocorrência'} className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl" />
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              aria-label="Fechar imagem"
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-eco-900 shadow-lg transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
