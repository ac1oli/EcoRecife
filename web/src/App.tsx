import React, { useState, useEffect } from 'react';
import { 
  MapPin, AlertTriangle, Recycle, Wifi, Truck, AlertCircle, ChevronRight,
  Search, Clock, Navigation, UploadCloud, CheckCircle, MapPinOff, Zap, 
  Users, BarChart3, ShieldCheck, Lock, PieChart, TrendingUp, AlertOctagon,
  ClipboardList, Building2, SlidersHorizontal, CircleDot
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LoginBrand, ManagementHeader, PublicFooter, PublicHeader, PublicMobileNav } from './components/AppShell';
import { OccurrenceCompletionDialog } from './components/OccurrenceCompletionDialog';
import { OccurrencePhotos } from './components/OccurrencePhotos';
import { PageIntro, ServiceCard } from './components/ui';
import { saveOccurrencePhotos } from './lib/occurrencePhotoStorage';
import type { ManagementView, MapLocation, Occurrence, OccurrenceStatus, Page } from './types';

const recifeCoords: [number, number] = [-8.0520, -34.8850];

const mapLocations: MapLocation[] = [
  { id: 1, type: "truck", name: "Caminhão #04 - Boa Viagem", neighborhood: "Boa Viagem", coords: [-8.1250, -34.9010], status: "Em rota de coleta", time: "Chegada prevista em 12 min", update: "há 1 min", color: "#087E5B" },
  { id: 2, type: "truck", name: "Caminhão #08 - Casa Amarela", neighborhood: "Casa Amarela", coords: [-8.0260, -34.9180], status: "Coleta residencial ativa", time: "Chegada prevista em 25 min", update: "há 3 min", color: "#087E5B" },
  { id: 7, type: "truck", name: "Caminhão #11 - Várzea", neighborhood: "Várzea", coords: [-8.0506, -34.9588], status: "Em rota de coleta seletiva", time: "Chegada prevista em 18 min", update: "há 2 min", color: "#087E5B" },
  { id: 8, type: "truck", name: "Caminhão #15 - Ibura", neighborhood: "Ibura", coords: [-8.1188, -34.9425], status: "Coleta residencial ativa", time: "Chegada prevista em 32 min", update: "há 4 min", color: "#087E5B" },
  { id: 9, type: "truck", name: "Caminhão #06 - Encruzilhada", neighborhood: "Encruzilhada", coords: [-8.0368, -34.8918], status: "Em deslocamento", time: "Chegada prevista em 9 min", update: "há 1 min", color: "#087E5B" },
  { id: 10, type: "truck", name: "Caminhão #13 - Cordeiro", neighborhood: "Cordeiro", coords: [-8.0474, -34.9287], status: "Coleta residencial ativa", time: "Chegada prevista em 21 min", update: "há 2 min", color: "#087E5B" },
  { id: 16, type: "truck", name: "Caminhão #17 - Vasco da Gama", neighborhood: "Vasco da Gama", coords: [-8.0118, -34.9174], status: "Em rota de coleta", time: "Chegada prevista em 14 min", update: "há 2 min", color: "#087E5B" },
  { id: 3, type: "eco", name: "EcoPonto Pina", neighborhood: "Pina", coords: [-8.0880, -34.8850], status: "Aberto para descarte", time: "Funcionamento: 8h às 17h", update: "Hoje", color: "#087EA4" },
  { id: 4, type: "eco", name: "EcoPonto Centro / Santo Antônio", neighborhood: "Santo Antônio", coords: [-8.0520, -34.8820], status: "Aberto para descarte", time: "Funcionamento: 8h às 18h", update: "Hoje", color: "#087EA4" },
  { id: 11, type: "eco", name: "EcoPonto Arruda", neighborhood: "Arruda", coords: [-8.0268, -34.8882], status: "Aberto para descarte", time: "Funcionamento: 8h às 17h", update: "Hoje", color: "#087EA4" },
  { id: 12, type: "eco", name: "EcoPonto Cohab", neighborhood: "Cohab", coords: [-8.1279, -34.9491], status: "Capacidade moderada", time: "Funcionamento: 8h às 16h", update: "há 20 min", color: "#087EA4" },
  { id: 13, type: "eco", name: "EcoPonto Torre", neighborhood: "Torre", coords: [-8.0479, -34.9104], status: "Aberto para descarte", time: "Funcionamento: 7h às 17h", update: "Hoje", color: "#087EA4" },
  { id: 17, type: "eco", name: "EcoPonto Casa Amarela", neighborhood: "Casa Amarela", coords: [-8.0208, -34.9251], status: "Aberto para descarte", time: "Funcionamento: 8h às 17h", update: "Hoje", color: "#087EA4" },
  { id: 5, type: "coop", name: "Cooperativa Novo Ciclo - Afogados", neighborhood: "Afogados", coords: [-8.0710, -34.9080], status: "Recebendo doações", time: "Atendimento: 8h às 16h", update: "Hoje", color: "#7259A6" },
  { id: 6, type: "coop", name: "Cooperativa Recicla Recife - Santo Amaro", neighborhood: "Santo Amaro", coords: [-8.0380, -34.8720], status: "Triagem em andamento", time: "Atendimento: 7h às 17h", update: "Hoje", color: "#7259A6" },
  { id: 14, type: "coop", name: "Cooperativa Esperança Verde", neighborhood: "Dois Unidos", coords: [-8.0018, -34.9108], status: "Recebendo recicláveis", time: "Atendimento: 8h às 17h", update: "Hoje", color: "#7259A6" },
  { id: 15, type: "coop", name: "Cooperativa Renascer", neighborhood: "Imbiribeira", coords: [-8.1111, -34.9103], status: "Triagem em andamento", time: "Atendimento: 7h às 16h", update: "há 15 min", color: "#7259A6" }
];

const neighborhoodCoords: Record<string, [number, number]> = {
  "boa viagem": [-8.1250, -34.9010],
  "pina": [-8.0880, -34.8850],
  "centro": [-8.0520, -34.8820],
  "santo antônio": [-8.0520, -34.8820],
  "santo amaro": [-8.0380, -34.8720],
  "afogados": [-8.0710, -34.9080],
  "casa amarela": [-8.0260, -34.9180],
  "várzea": [-8.0506, -34.9588],
  "ibura": [-8.1188, -34.9425],
  "encruzilhada": [-8.0368, -34.8918],
  "cordeiro": [-8.0474, -34.9287],
  "arruda": [-8.0268, -34.8882],
  "cohab": [-8.1279, -34.9491],
  "torre": [-8.0479, -34.9104],
  "vasco da gama": [-8.0118, -34.9174],
  "dois unidos": [-8.0018, -34.9108],
  "imbiribeira": [-8.1111, -34.9103]
};

const ecoPointsList = [
  { id: 3, name: "EcoPonto Pina", neighborhood: "Pina", dist: "1,2 km de você", hours: "Seg–Sáb · 8h às 17h", materials: "Papel, vidro, plástico, pequenos eletrônicos e óleo vegetal.", tags: ["reciclaveis", "eletronicos"], type: "eco" },
  { id: 4, name: "EcoPonto Centro", neighborhood: "Santo Antônio", dist: "2,8 km de você", hours: "Seg–Sáb · 8h às 18h", materials: "Entulho de pequenas obras, móveis velhos, papelão e metais.", tags: ["reciclaveis", "volumosos"], type: "eco" },
  { id: 5, name: "Cooperativa Novo Ciclo", neighborhood: "Afogados", dist: "3,4 km de você", hours: "Seg–Sex · 8h às 16h", materials: "Triagem de materiais recicláveis em geral e cooperativismo.", tags: ["reciclaveis", "cooperativas"], type: "coop" },
  { id: 6, name: "Cooperativa Recicla Recife", neighborhood: "Santo Amaro", dist: "4,1 km de você", hours: "Seg–Sáb · 7h às 17h", materials: "Aparas de papel, papelão corrugado e garrafas PET.", tags: ["cooperativas", "reciclaveis"], type: "coop" },
  { id: 17, name: "EcoPonto Casa Amarela", neighborhood: "Casa Amarela", dist: "5,0 km de você", hours: "Seg–Sáb · 8h às 17h", materials: "Resíduos eletroeletrônicos, pilhas, baterias e volumosos.", tags: ["eletronicos", "volumosos"], type: "eco" }
];

const initialOccurrences: Occurrence[] = [
  { id: 1, protocol: 'ECO-2026-4831', type: 'Descarte irregular', neighborhood: 'Boa Viagem', address: 'Rua dos Navegantes, 840', description: 'Sacos de resíduos e móveis ocupando parte da calçada.', reportedAt: 'Hoje, 08:42', status: 'Recebida', priority: 'Urgente' },
  { id: 2, protocol: 'ECO-2026-4728', type: 'Acúmulo de entulho', neighborhood: 'Casa Amarela', address: 'Estrada do Arraial, 2180', description: 'Entulho de obra acumulado próximo ao ponto de ônibus.', reportedAt: 'Hoje, 07:18', status: 'Em análise', priority: 'Alta' },
  { id: 3, protocol: 'ECO-2026-4692', type: 'Lixeira danificada', neighborhood: 'Pina', address: 'Rua Capitão Rebelinho, 455', description: 'Contentor sem tampa e com resíduos espalhados na via.', reportedAt: 'Ontem, 18:05', status: 'Equipe designada', priority: 'Alta' },
  { id: 4, protocol: 'ECO-2026-4617', type: 'Descarte irregular', neighborhood: 'Santo Amaro', address: 'Av. Norte Miguel Arraes, 1040', description: 'Ponto recorrente de descarte ao lado do canal.', reportedAt: 'Ontem, 15:32', status: 'Recebida', priority: 'Média' },
  { id: 5, protocol: 'ECO-2026-4580', type: 'Acúmulo de entulho', neighborhood: 'Afogados', address: 'Rua Imperial, 1875', description: 'Restos de construção bloqueando a passagem de pedestres.', reportedAt: 'Ontem, 11:47', status: 'Em análise', priority: 'Média' },
  { id: 6, protocol: 'ECO-2026-4499', type: 'Lixeira danificada', neighborhood: 'Centro', address: 'Rua do Imperador Pedro II, 290', description: 'Lixeira pública danificada em área de grande circulação.', reportedAt: '12 jun, 16:20', status: 'Concluída', priority: 'Baixa', completedAt: '12/06/2026, 17:05' },
  { id: 7, protocol: 'ECO-2026-4435', type: 'Descarte irregular', neighborhood: 'Boa Viagem', address: 'Av. Conselheiro Aguiar, 3120', description: 'Resíduos volumosos deixados no canteiro central.', reportedAt: '12 jun, 09:15', status: 'Equipe designada', priority: 'Alta' },
  { id: 8, protocol: 'ECO-2026-4381', type: 'Acúmulo de entulho', neighborhood: 'Casa Amarela', address: 'Rua Padre Lemos, 610', description: 'Materiais de obra descartados junto à drenagem.', reportedAt: '11 jun, 14:08', status: 'Concluída', priority: 'Média', completedAt: '11/06/2026, 16:42', completionNote: 'Entulho recolhido e drenagem desobstruída.' }
];

const OCCURRENCES_STORAGE_KEY = 'ecorecife:occurrences:v2';
const LEGACY_OCCURRENCES_STORAGE_KEY = 'ecorecife:occurrences:v1';
type StoredOccurrence = Omit<Occurrence, 'status'> & { status: OccurrenceStatus | 'Resolvida' };

const isStoredOccurrence = (value: unknown): value is StoredOccurrence => {
  if (!value || typeof value !== 'object') return false;
  const occurrence = value as Record<string, unknown>;
  return typeof occurrence.id === 'number'
    && typeof occurrence.protocol === 'string'
    && typeof occurrence.type === 'string'
    && typeof occurrence.neighborhood === 'string'
    && typeof occurrence.address === 'string'
    && typeof occurrence.description === 'string'
    && typeof occurrence.reportedAt === 'string'
    && ['Recebida', 'Em análise', 'Equipe designada', 'Concluída', 'Resolvida'].includes(String(occurrence.status))
    && ['Urgente', 'Alta', 'Média', 'Baixa'].includes(String(occurrence.priority));
};

const normalizeOccurrence = (occurrence: StoredOccurrence): Occurrence => ({
  ...occurrence,
  status: occurrence.status === 'Resolvida' ? 'Concluída' : occurrence.status
});

const loadOccurrences = (): Occurrence[] => {
  if (typeof window === 'undefined') return [...initialOccurrences];
  try {
    const savedOccurrences = window.localStorage.getItem(OCCURRENCES_STORAGE_KEY);
    if (savedOccurrences) {
      const parsedOccurrences: unknown = JSON.parse(savedOccurrences);
      if (Array.isArray(parsedOccurrences) && parsedOccurrences.every(isStoredOccurrence)) {
        return parsedOccurrences.map(normalizeOccurrence);
      }
    }

    const legacyOccurrences = window.localStorage.getItem(LEGACY_OCCURRENCES_STORAGE_KEY);
    if (!legacyOccurrences) return [...initialOccurrences];
    const parsedLegacyOccurrences: unknown = JSON.parse(legacyOccurrences);
    if (!Array.isArray(parsedLegacyOccurrences) || !parsedLegacyOccurrences.every(isStoredOccurrence)) {
      return [...initialOccurrences];
    }

    const migratedOccurrences = parsedLegacyOccurrences.map(normalizeOccurrence);
    window.localStorage.setItem(OCCURRENCES_STORAGE_KEY, JSON.stringify(migratedOccurrences));
    window.localStorage.removeItem(LEGACY_OCCURRENCES_STORAGE_KEY);
    return migratedOccurrences;
  } catch {
    return [...initialOccurrences];
  }
};

const occurrenceTypeLabels: Record<string, string> = {
  descarte: 'Descarte irregular',
  lixeira: 'Lixeira danificada',
  entulho: 'Acúmulo de entulho'
};

const reportNeighborhoods = Array.from(new Set(mapLocations.map(location => location.neighborhood))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

function MapController({ selectedPoint, center }: { selectedPoint: MapLocation | null, center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (selectedPoint) {
      map.flyTo(selectedPoint.coords, 15);
    } else {
      map.flyTo(center, 13);
    }
  }, [selectedPoint, center, map]);
  return null;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('inicio');
  const [selectedMapPoint, setSelectedMapPoint] = useState<MapLocation | null>(null);
  const [mapSearch, setMapSearch] = useState('');
  const [mapAlert, setMapAlert] = useState('');
  const [mapTypeFilter, setMapTypeFilter] = useState<'all' | 'truck' | 'eco' | 'coop'>('all');
  const [ecoFilter, setEcoFilter] = useState('all');
  const [ecoSearch, setEcoSearch] = useState('');
  const [peopleCount, setPeopleCount] = useState(3);
  
  const [reportPhotos, setReportPhotos] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [reportProtocol, setReportProtocol] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [managementView, setManagementView] = useState<ManagementView>('ocorrencias');
  const [occurrences, setOccurrences] = useState<Occurrence[]>(loadOccurrences);
  const [occurrenceSearch, setOccurrenceSearch] = useState('');
  const [occurrenceStatusFilter, setOccurrenceStatusFilter] = useState('Todos');
  const [occurrenceNeighborhoodFilter, setOccurrenceNeighborhoodFilter] = useState('Todos');
  const [occurrenceQueueView, setOccurrenceQueueView] = useState<'ativas' | 'historico'>('ativas');
  const [occurrenceToComplete, setOccurrenceToComplete] = useState<Occurrence | null>(null);

  useEffect(() => {
    const syncPageFromHash = () => {
      const hash = window.location.hash.replace('#', '') as Page;
      if (['inicio', 'coleta', 'zeladoria', 'ecopontos', 'beneficios', 'login', 'gestao'].includes(hash)) {
        setCurrentPage(hash);
      }
    };
    syncPageFromHash();
    window.addEventListener('hashchange', syncPageFromHash);
    return () => window.removeEventListener('hashchange', syncPageFromHash);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OCCURRENCES_STORAGE_KEY, JSON.stringify(occurrences));
    } catch {
      // The prototype keeps working in memory when browser storage is unavailable.
    }
  }, [occurrences]);

  const navigateTo = (page: Page) => {
    if (page !== currentPage) {
      setCurrentPage(page);
      if (window.location.hash !== `#${page}`) {
        window.location.hash = page;
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleMapSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const input = mapSearch.trim().toLowerCase();
    const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedInput = normalizeSearch(input);
    const foundKey = Object.keys(neighborhoodCoords).find(key => normalizedInput.includes(normalizeSearch(key)));
    if (foundKey) {
      setSelectedMapPoint({
        id: -1, type: "search", name: `Bairro: ${foundKey.toUpperCase()}`, neighborhood: foundKey, coords: neighborhoodCoords[foundKey], status: "Bairro encontrado", time: "Explore os pontos próximos no mapa", update: "agora", color: "#087EA4"
      });
      setMapAlert(`Navegando para o bairro: ${foundKey.toUpperCase()}`);
    } else {
      setMapAlert(input ? `Bairro "${input}" não encontrado na busca rápida.` : "Digite o nome de um bairro.");
    }
    setTimeout(() => setMapAlert(''), 5000);
  };

  const changeMapTypeFilter = (filter: 'all' | 'truck' | 'eco' | 'coop') => {
    setMapTypeFilter(filter);
    if (selectedMapPoint && selectedMapPoint.type !== 'search' && filter !== 'all' && selectedMapPoint.type !== filter) {
      setSelectedMapPoint(null);
    }
  };

  const filteredMapLocations = mapLocations.filter(location => mapTypeFilter === 'all' || location.type === mapTypeFilter);
  const normalizedEcoSearch = ecoSearch.trim().toLocaleLowerCase('pt-BR');
  const filteredEcoPoints = ecoPointsList.filter(item => {
    const matchesCategory = ecoFilter === 'all' || item.tags.includes(ecoFilter);
    const matchesSearch = !normalizedEcoSearch || [item.name, item.neighborhood, item.materials, item.dist]
      .some(value => value.toLocaleLowerCase('pt-BR').includes(normalizedEcoSearch));
    return matchesCategory && matchesSearch;
  });

  const handleReportPhotos = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    if (reportPhotos.length + selectedFiles.length > 3) {
      setReportError('Você pode anexar no máximo três imagens.');
      return;
    }
    if (selectedFiles.some(file => !file.type.startsWith('image/'))) {
      setReportError('Selecione apenas arquivos de imagem.');
      return;
    }
    if (selectedFiles.some(file => file.size > 5 * 1024 * 1024)) {
      setReportError('Cada imagem deve ter no máximo 5 MB.');
      return;
    }
    setReportPhotos(current => [
      ...current,
      ...selectedFiles.map(file => ({ file, previewUrl: URL.createObjectURL(file) }))
    ]);
    setReportError(null);
  };

  const removeReportPhoto = (previewUrl: string) => {
    URL.revokeObjectURL(previewUrl);
    setReportPhotos(current => current.filter(photo => photo.previewUrl !== previewUrl));
  };

  const clearReportPhotos = () => {
    reportPhotos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
    setReportPhotos([]);
  };

  const handleReportSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (!formData.get('type') || !formData.get('neighborhood') || !formData.get('location') || !formData.get('desc')) {
      setReportError("Por favor, preencha todos os campos obrigatórios (*).");
      return;
    }
    const protocol = `ECO-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const address = String(formData.get('location'));
    const neighborhood = String(formData.get('neighborhood')).trim();
    const occurrenceId = Date.now();
    try {
      await saveOccurrencePhotos(occurrenceId, reportPhotos.map(photo => photo.file));
    } catch {
      setReportError('Não foi possível salvar as imagens. Tente novamente.');
      return;
    }
    setOccurrences(current => [{
      id: occurrenceId,
      protocol,
      type: occurrenceTypeLabels[String(formData.get('type'))] || 'Ocorrência ambiental',
      neighborhood,
      address,
      description: String(formData.get('desc')),
      reportedAt: 'Agora',
      status: 'Recebida',
      priority: 'Média'
    }, ...current]);
    setReportError(null);
    setReportProtocol(protocol);
    clearReportPhotos();
  };

  const updateOccurrenceStatus = (id: number, status: OccurrenceStatus) => {
    setOccurrences(current => current.map(occurrence => occurrence.id === id ? { ...occurrence, status } : occurrence));
  };

  const completeOccurrence = (note: string) => {
    if (!occurrenceToComplete) return;
    const completedAt = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date());
    setOccurrences(current => current.map(occurrence => occurrence.id === occurrenceToComplete.id
      ? { ...occurrence, status: 'Concluída', completedAt, completionNote: note || undefined }
      : occurrence
    ));
    setOccurrenceToComplete(null);
  };

  const enterManagement = () => {
    setManagementView('ocorrencias');
    setOccurrenceSearch('');
    setOccurrenceStatusFilter('Todos');
    setOccurrenceNeighborhoodFilter('Todos');
    setOccurrenceQueueView('ativas');
    navigateTo('gestao');
  };

  const activeOccurrences = occurrences.filter(occurrence => occurrence.status !== 'Concluída');
  const completedOccurrences = occurrences.filter(occurrence => occurrence.status === 'Concluída');
  const occurrencesInQueue = occurrenceQueueView === 'ativas' ? activeOccurrences : completedOccurrences;
  const filteredOccurrences = occurrencesInQueue.filter(occurrence => {
    const search = occurrenceSearch.trim().toLocaleLowerCase('pt-BR');
    const matchesSearch = !search || [occurrence.protocol, occurrence.type, occurrence.neighborhood, occurrence.address]
      .some(value => value.toLocaleLowerCase('pt-BR').includes(search));
    const matchesStatus = occurrenceStatusFilter === 'Todos' || occurrence.status === occurrenceStatusFilter;
    const matchesNeighborhood = occurrenceNeighborhoodFilter === 'Todos' || occurrence.neighborhood === occurrenceNeighborhoodFilter;
    return matchesSearch && matchesStatus && matchesNeighborhood;
  });

  const neighborhoodSummary = Array.from(new Set(occurrences.map(occurrence => occurrence.neighborhood)))
    .map(neighborhood => ({
      neighborhood,
      total: occurrences.filter(occurrence => occurrence.neighborhood === neighborhood).length,
      pending: occurrences.filter(occurrence => occurrence.neighborhood === neighborhood && occurrence.status !== 'Concluída').length
    }))
    .sort((a, b) => b.pending - a.pending || b.total - a.total);

  const isPublicPage = !['login', 'gestao'].includes(currentPage);

  return (
    <div className="min-h-full flex flex-col bg-canvas font-sans text-eco-900 antialiased selection:bg-eco-200 selection:text-eco-900">
      {isPublicPage && <PublicHeader currentPage={currentPage} navigateTo={navigateTo} />}
      {currentPage === 'gestao' && <ManagementHeader onExit={() => navigateTo('inicio')} />}

      <main className={`flex-1 ${isPublicPage ? 'min-h-[calc(100dvh-4rem)]' : ''}`}>
        {/* INICIO */}
        {currentPage === 'inicio' && (
          <section>
            <div className="urban-grid border-b border-emerald-100">
              <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-12 lg:items-center lg:py-20">
                <div className="space-y-6 lg:col-span-7">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-wider text-eco-700 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-eco-500" /> Serviços ambientais do Recife
                  </div>
                  <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-eco-900 sm:text-5xl lg:text-6xl">
                    Cuidar do Recife ficou <span className="text-eco-600">mais simples.</span>
                  </h1>
                  <p className="max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">Acompanhe a coleta, relate problemas ambientais e encontre o local certo para descartar seus resíduos.</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button type="button" onClick={() => navigateTo('coleta')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-eco-600 px-6 text-base font-extrabold text-white shadow-lg shadow-emerald-900/10 transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2">
                      <Truck className="h-5 w-5" /> Acompanhar coleta
                    </button>
                    <button type="button" onClick={() => navigateTo('zeladoria')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 text-base font-extrabold text-eco-900 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600">
                      <AlertTriangle className="h-5 w-5 text-amber-600" /> Relatar ocorrência
                    </button>
                  </div>
                </div>
                <div className="lg:col-span-5">
                  <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-xl shadow-emerald-900/5">
                    <div className="flex items-center justify-between border-b border-slate-100 p-5">
                      <div>
                        <p className="text-sm font-extrabold text-eco-900">Operação de hoje</p>
                        <p className="mt-0.5 text-xs text-slate-500">Dados demonstrativos atualizados agora</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-eco-700"><Wifi className="h-3.5 w-3.5" /> Ativa</span>
                    </div>
                    <div className="grid grid-cols-2 gap-px bg-slate-100">
                      {[
                        ['18', 'Caminhões ativos', 'text-eco-700'],
                        ['24', 'EcoPontos abertos', 'text-ecoblue-700'],
                        ['12', 'Cooperativas', 'text-purple-700'],
                        ['94%', 'Meta de coleta', 'text-amber-700']
                      ].map(([value, label, color]) => (
                        <div key={label} className="bg-white p-5">
                          <p className={`text-3xl font-extrabold ${color}`}>{value}</p>
                          <p className="mt-1 text-xs font-bold text-slate-500">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white py-12 sm:py-16">
              <div className="mx-auto max-w-7xl px-4 sm:px-6">
                <div className="mb-8">
                  <p className="text-xs font-extrabold uppercase tracking-widest text-eco-600">Acesso rápido</p>
                  <h2 className="mt-1 text-2xl font-extrabold text-eco-900 sm:text-3xl">O que você precisa fazer?</h2>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  <ServiceCard icon={Truck} title="Acompanhar a coleta" description="Consulte caminhões, horários e pontos de atendimento próximos ao seu bairro." action="Abrir mapa" onClick={() => navigateTo('coleta')} />
                  <ServiceCard icon={AlertTriangle} title="Relatar um problema" description="Informe descarte irregular, entulho ou lixeira danificada e receba um protocolo." action="Fazer relato" tone="amber" onClick={() => navigateTo('zeladoria')} />
                  <ServiceCard icon={Recycle} title="Encontrar descarte correto" description="Veja EcoPontos e cooperativas para recicláveis, eletrônicos e resíduos volumosos." action="Encontrar local" tone="blue" onClick={() => navigateTo('ecopontos')} />
                </div>
              </div>
            </div>

            <div className="border-t border-emerald-100 bg-emerald-50/50 py-12">
              <div className="mx-auto max-w-7xl px-4 sm:px-6">
                <div className="grid gap-6 md:grid-cols-3">
                  {[
                    ['1', 'Escolha o serviço', 'Acesse coleta, ocorrências ou pontos de descarte.'],
                    ['2', 'Informe seu bairro', 'Encontre informações relevantes para sua região.'],
                    ['3', 'Acompanhe a resposta', 'Consulte horários, status e protocolos em um só lugar.']
                  ].map(([step, title, text]) => (
                    <div key={step} className="flex gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-eco-600 font-extrabold text-white">{step}</span>
                      <div><h3 className="font-extrabold text-eco-900">{title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* MAPA */}
        {currentPage === 'coleta' && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <PageIntro
              eyebrow="Mapa de serviços"
              title="Coleta e pontos próximos"
              description="Busque seu bairro, acompanhe os caminhões e consulte locais de descarte disponíveis."
              aside={<span className="inline-flex w-fit items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-bold text-amber-800"><AlertCircle className="h-4 w-4" /> Dados simulados para demonstração</span>}
            />

            <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <form onSubmit={handleMapSearch} className="flex min-w-0 flex-1">
                  <div className="flex w-full items-center rounded-xl border border-slate-200 bg-slate-50 p-1 focus-within:border-eco-600 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100">
                    <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
                    <input type="search" value={mapSearch} onChange={e => setMapSearch(e.target.value)} aria-label="Buscar bairro no mapa" placeholder="Digite seu bairro" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none" />
                    <button type="submit" className="min-h-10 shrink-0 rounded-lg bg-eco-600 px-4 text-xs font-extrabold text-white transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600">Buscar</button>
                  </div>
                </form>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:pb-0" aria-label="Filtrar pontos do mapa">
                  {[
                    { value: 'all', label: 'Todos', count: mapLocations.length, color: 'bg-slate-400' },
                    { value: 'truck', label: 'Caminhões', count: mapLocations.filter(item => item.type === 'truck').length, color: 'bg-eco-600' },
                    { value: 'eco', label: 'EcoPontos', count: mapLocations.filter(item => item.type === 'eco').length, color: 'bg-ecoblue-600' },
                    { value: 'coop', label: 'Cooperativas', count: mapLocations.filter(item => item.type === 'coop').length, color: 'bg-purple-600' }
                  ].map(filter => (
                    <button type="button" key={filter.value} onClick={() => changeMapTypeFilter(filter.value as 'all' | 'truck' | 'eco' | 'coop')} aria-pressed={mapTypeFilter === filter.value} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-extrabold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 ${mapTypeFilter === filter.value ? 'border-eco-700 bg-eco-900 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-eco-800'}`}>
                      <span className={`h-2.5 w-2.5 rounded-full ${filter.color}`} />
                      {filter.label}<span className={mapTypeFilter === filter.value ? 'text-emerald-200' : 'text-slate-400'}>{filter.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 bg-white rounded-3xl p-3 shadow-sm border border-slate-200 relative">
                <MapContainer center={recifeCoords} zoom={13} className="h-full min-h-[400px] w-full rounded-2xl z-10 sm:min-h-[520px]">
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
                  />
                  <MapController selectedPoint={selectedMapPoint} center={recifeCoords} />
                  {filteredMapLocations.map(loc => {
                    const markerLabel = loc.type === 'truck' ? 'C' : loc.type === 'eco' ? 'E' : 'R';
                    const iconHtml = `<div class="custom-marker custom-marker--${loc.type}" style="background-color: ${loc.color};"><span>${markerLabel}</span></div>`;
                    const customIcon = L.divIcon({ className: 'custom-leaflet-icon', html: iconHtml, iconSize: [32, 32], iconAnchor: [16, 16] });
                    return <Marker key={loc.id} position={loc.coords} icon={customIcon} title={loc.name} eventHandlers={{ click: () => setSelectedMapPoint(loc) }} />;
                  })}
                </MapContainer>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-2 py-1 text-xs text-slate-600">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 font-medium"><span className="h-3 w-3 rounded-full bg-eco-600"></span> Caminhões</span>
                    <span className="flex items-center gap-1.5 font-medium"><span className="h-3 w-3 rounded-full bg-ecoblue-600"></span> EcoPontos</span>
                    <span className="flex items-center gap-1.5 font-medium"><span className="h-3 w-3 rounded-full bg-purple-600"></span> Cooperativas</span>
                  </div>
                  <span className="font-semibold text-slate-500">{filteredMapLocations.length} pontos visíveis</span>
                </div>
              </div>

              <div className="lg:col-span-4 bg-white rounded-3xl p-6 shadow-lg border border-emerald-100 space-y-5">
                <div>
                  <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase text-eco-800">
                    {selectedMapPoint ? (selectedMapPoint.type === 'truck' ? 'Caminhão de Coleta' : selectedMapPoint.type === 'eco' ? 'EcoPonto Municipal' : selectedMapPoint.type === 'coop' ? 'Cooperativa Parceira' : 'Ponto de Interesse') : 'Selecione no mapa'}
                  </span>
                  <h2 className="mt-2 text-xl font-extrabold text-eco-900">{selectedMapPoint?.name || 'Escolha um local'}</h2>
                  {!selectedMapPoint && <p className="mt-2 text-sm leading-relaxed text-slate-500">Toque em um marcador ou selecione um item da lista para consultar os detalhes.</p>}
                </div>
                <div className="space-y-3 pt-2">
                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
                    <p className="text-xs font-bold uppercase text-slate-500">Status Operacional</p>
                    <p className="mt-1 font-bold text-slate-800">{selectedMapPoint?.status || 'Aguardando seleção do usuário'}</p>
                  </div>
                  <div className="rounded-2xl bg-ecoblue-50 p-4 border border-ecoblue-100">
                    <p className="text-xs font-bold uppercase text-ecoblue-700">Previsão / Atendimento</p>
                    <p className="mt-1 font-bold text-ecoblue-900">{selectedMapPoint?.time || 'Clique no marcador desejado'}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                    <Clock className="h-4 w-4" />
                    <span>Última atualização: <strong>{selectedMapPoint?.update || 'agora'}</strong></span>
                  </div>
                </div>
                <button type="button" onClick={() => {
                  if(!selectedMapPoint) { setMapAlert("Selecione um ponto!"); setTimeout(() => setMapAlert(''), 3000); return;}
                  setMapAlert(`Simulação preparada até ${selectedMapPoint.name}.`); setTimeout(() => setMapAlert(''), 4000);
                }} className="w-full rounded-xl bg-eco-600 py-3 text-sm font-bold text-white shadow-md hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2">
                  <Navigation className="h-4 w-4" /> Simular rota até o local
                </button>
                <div aria-live="polite">{mapAlert && <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-200 text-xs text-eco-800 font-semibold">{mapAlert}</div>}</div>
                <div className="border-t border-slate-100 pt-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-eco-900">Pontos exibidos</h3>
                    <span className="text-[11px] font-semibold text-slate-400">{filteredMapLocations.length} locais</span>
                  </div>
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {filteredMapLocations.map(location => (
                      <button type="button" key={location.id} onClick={() => setSelectedMapPoint(location)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${selectedMapPoint?.id === location.id ? 'border-eco-600 bg-emerald-50' : 'border-slate-100 hover:border-emerald-200 hover:bg-slate-50'}`}>
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold text-white ${location.type === 'truck' ? 'bg-eco-600' : location.type === 'eco' ? 'bg-ecoblue-600' : 'bg-purple-600'}`}>
                          {location.type === 'truck' ? 'C' : location.type === 'eco' ? 'E' : 'R'}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-eco-900">{location.name}</span>
                          <span className="block text-[11px] text-slate-500">{location.neighborhood}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ZELADORIA */}
        {currentPage === 'zeladoria' && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <PageIntro eyebrow="Zeladoria cidadã" title="Relate um problema ambiental" description="Informe o que aconteceu e receba um protocolo para acompanhar o atendimento pela gestão." />
            <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
              <aside className="rounded-3xl bg-eco-900 p-6 text-white lg:col-span-4 lg:sticky lg:top-24">
                <span className="inline-flex items-center gap-2 rounded-full bg-eco-800 px-3 py-1 text-xs font-bold text-emerald-200"><ShieldCheck className="h-4 w-4" /> Participação segura</span>
                <h2 className="mt-5 text-2xl font-extrabold">Seu relato ajuda a cidade a agir melhor.</h2>
                <p className="mt-3 text-sm leading-relaxed text-emerald-100/80">Leva cerca de dois minutos. Você pode anexar até três fotos e o protocolo é gerado imediatamente.</p>
                <div className="mt-7 space-y-5 border-t border-eco-800 pt-6">
                  {[
                    ['1', 'Conte o que aconteceu'],
                    ['2', 'Informe bairro e endereço'],
                    ['3', 'Receba seu protocolo']
                  ].map(([step, label]) => (
                    <div key={step} className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-eco-700 text-xs font-extrabold">{step}</span>
                      <span className="text-sm font-bold text-emerald-50">{label}</span>
                    </div>
                  ))}
                </div>
              </aside>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 lg:col-span-8">
                {!reportProtocol ? (
                  <form onSubmit={handleReportSubmit} className="space-y-7">
                    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-5">
                      <div><h2 className="text-xl font-extrabold text-eco-900">Nova ocorrência</h2><p className="mt-1 text-xs text-slate-500">Campos com * são obrigatórios.</p></div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-eco-700">Protocolo imediato</span>
                    </div>

                    <fieldset className="space-y-4">
                      <legend className="mb-4 flex items-center gap-3 text-base font-extrabold text-eco-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-eco-600 text-xs text-white">1</span> O que aconteceu</legend>
                      <div>
                        <label htmlFor="report-type" className="mb-1.5 block text-sm font-bold text-eco-900">Tipo de ocorrência *</label>
                        <select id="report-type" name="type" required className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-eco-600 focus:ring-2 focus:ring-emerald-100">
                          <option value="">Selecione uma categoria</option>
                          <option value="descarte">Descarte irregular em via pública</option>
                          <option value="lixeira">Lixeira comunitária danificada</option>
                          <option value="entulho">Acúmulo de entulho de obra</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="report-description" className="mb-1.5 block text-sm font-bold text-eco-900">Descrição *</label>
                        <textarea id="report-description" name="desc" required rows={4} placeholder="Descreva o problema e inclua referências que ajudem a equipe." className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-eco-600 focus:ring-2 focus:ring-emerald-100" />
                      </div>
                    </fieldset>

                    <fieldset className="space-y-4 border-t border-slate-100 pt-6">
                      <legend className="mb-4 flex items-center gap-3 text-base font-extrabold text-eco-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ecoblue-600 text-xs text-white">2</span> Onde aconteceu</legend>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="report-neighborhood" className="mb-1.5 block text-sm font-bold text-eco-900">Bairro *</label>
                          <input id="report-neighborhood" name="neighborhood" list="recife-neighborhoods" required placeholder="Ex: Vasco da Gama" className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-eco-600 focus:ring-2 focus:ring-emerald-100" />
                          <datalist id="recife-neighborhoods">{reportNeighborhoods.map(neighborhood => <option key={neighborhood} value={neighborhood} />)}</datalist>
                        </div>
                        <div>
                          <label htmlFor="report-address" className="mb-1.5 block text-sm font-bold text-eco-900">Endereço ou referência *</label>
                          <input id="report-address" type="text" name="location" required placeholder="Ex: Rua, número ou ponto próximo" className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-eco-600 focus:ring-2 focus:ring-emerald-100" />
                        </div>
                      </div>
                    </fieldset>

                    <fieldset className="border-t border-slate-100 pt-6">
                      <legend className="mb-4 flex items-center gap-3 text-base font-extrabold text-eco-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-xs text-white">3</span> Adicione imagens <span className="text-xs font-medium text-slate-400">(opcional)</span></legend>
                      <div className="space-y-3">
                        {reportPhotos.length < 3 && (
                          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/50 p-5 text-center transition hover:bg-emerald-50">
                            <UploadCloud className="h-8 w-8 text-eco-600" />
                            <span className="mt-2 text-sm font-extrabold text-eco-800">Selecionar {reportPhotos.length ? 'mais imagens' : 'imagens'}</span>
                            <span className="mt-1 text-xs text-slate-500">Até 3 arquivos PNG, JPG ou WEBP · máximo de 5 MB cada</span>
                            <input type="file" accept="image/*" multiple onChange={event => { handleReportPhotos(event.target.files); event.target.value = ''; }} className="sr-only" />
                          </label>
                        )}
                        {reportPhotos.length > 0 && (
                          <div className="grid gap-3 sm:grid-cols-3">
                            {reportPhotos.map((photo, index) => (
                              <div key={photo.previewUrl} className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
                                <img src={photo.previewUrl} alt={`Prévia da imagem ${index + 1}`} className="h-28 w-full object-cover" />
                                <div className="flex items-center justify-between gap-2 p-3">
                                  <span className="truncate text-xs font-bold text-eco-900">Imagem {index + 1}</span>
                                  <button type="button" onClick={() => removeReportPhoto(photo.previewUrl)} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:text-red-600">Remover</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {reportPhotos.length === 3 && (
                          <p className="text-xs font-semibold text-eco-700">Limite de três imagens atingido.</p>
                        )}
                      </div>
                    </fieldset>

                    <div aria-live="assertive">{reportError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{reportError}</div>}</div>
                    <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-eco-600 px-5 text-base font-extrabold text-white shadow-lg shadow-emerald-900/10 transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2">
                      <CheckCircle className="h-5 w-5" /> Registrar e gerar protocolo
                    </button>
                  </form>
                ) : (
                  <div className="space-y-5 py-8 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-eco-600"><CheckCircle className="h-9 w-9" /></div>
                    <div>
                      <h2 className="text-2xl font-extrabold text-eco-900">Ocorrência registrada</h2>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">Seu relato foi encaminhado para a Central de Ocorrências da gestão.</p>
                    </div>
                    <div className="mx-auto max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                      <p className="text-xs font-bold uppercase tracking-wider text-eco-700">Número de Protocolo</p>
                      <p className="mt-1 text-2xl font-extrabold text-eco-900">{reportProtocol}</p>
                    </div>
                    <div className="flex flex-col justify-center gap-3 sm:flex-row">
                      <button type="button" onClick={() => { setReportProtocol(null); clearReportPhotos(); }} className="min-h-11 rounded-xl bg-eco-600 px-5 text-sm font-bold text-white hover:bg-eco-700">Registrar outra ocorrência</button>
                      <button type="button" onClick={() => navigateTo('inicio')} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">Voltar ao início</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ECOPONTOS */}
        {currentPage === 'ecopontos' && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <PageIntro eyebrow="Descarte responsável" title="Encontre EcoPontos e cooperativas" description="Busque locais de entrega e descubra onde descartar cada tipo de material." />
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" value={ecoSearch} onChange={event => setEcoSearch(event.target.value)} aria-label="Buscar EcoPonto, cooperativa ou material" placeholder="Buscar por local, bairro ou material aceito" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-eco-600 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar materiais">
                {['all', 'reciclaveis', 'eletronicos', 'volumosos', 'cooperativas'].map(cat => (
                  <button type="button" key={cat} onClick={() => setEcoFilter(cat)} aria-pressed={ecoFilter === cat} className={`min-h-10 shrink-0 rounded-full border px-4 text-xs font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 ${ecoFilter === cat ? 'border-eco-700 bg-eco-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'}`}>
                    {cat === 'all' ? 'Todos' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-500">{filteredEcoPoints.length} {filteredEcoPoints.length === 1 ? 'local encontrado' : 'locais encontrados'}</p>
                {(ecoFilter !== 'all' || ecoSearch) && <button type="button" onClick={() => { setEcoFilter('all'); setEcoSearch(''); }} className="text-xs font-extrabold text-eco-700 hover:text-eco-900">Limpar filtros</button>}
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredEcoPoints.map(item => (
                <article key={item.id} className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${item.type === 'coop' ? 'bg-purple-50 text-purple-700' : 'bg-ecoblue-50 text-ecoblue-700'}`}>{item.type === 'coop' ? 'Cooperativa' : 'EcoPonto'}</span>
                        <h2 className="mt-3 text-lg font-extrabold text-eco-900">{item.name}</h2>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-eco-700"><span className="h-2 w-2 rounded-full bg-eco-500" /> Aberto</span>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><MapPin className="h-3.5 w-3.5 text-ecoblue-600" /> {item.neighborhood} · {item.dist}</p>
                    <div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
                      <p className="flex items-start gap-2 font-semibold"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {item.hours}</p>
                      <p className="flex items-start gap-2 leading-relaxed"><Recycle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-eco-600" /><span><strong className="text-slate-800">Aceita:</strong> {item.materials}</span></p>
                    </div>
                  </div>
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <button type="button" onClick={() => { setSelectedMapPoint(mapLocations.find(l => l.id === item.id) || null); navigateTo('coleta'); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ecoblue-50 text-xs font-extrabold text-ecoblue-700 transition hover:bg-ecoblue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ecoblue-600">
                      <Navigation className="h-3.5 w-3.5" /> Ver no Mapa
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {filteredEcoPoints.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white py-14 text-center">
                <MapPinOff className="mx-auto h-10 w-10 text-slate-400" />
                <h2 className="mt-3 font-extrabold text-eco-900">Nenhum local encontrado</h2>
                <p className="mt-1 text-sm text-slate-500">Tente outro termo ou remova os filtros.</p>
                <button type="button" onClick={() => { setEcoFilter('all'); setEcoSearch(''); }} className="mt-5 min-h-10 rounded-xl bg-eco-600 px-4 text-xs font-bold text-white hover:bg-eco-700">Limpar filtros</button>
              </div>
            )}
          </section>
        )}

        {/* BENEFÍCIOS */}
        {currentPage === 'beneficios' && (
          <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
            <PageIntro eyebrow="Impacto positivo" title="Pequenas escolhas transformam a cidade" description="Veja como informação, descarte correto e participação cidadã geram benefícios para todo o Recife." />

            <div className="mb-12 overflow-hidden rounded-3xl bg-eco-900 text-white shadow-xl shadow-emerald-900/10">
              <div className="grid lg:grid-cols-12">
                <div className="p-7 sm:p-10 lg:col-span-7">
                  <span className="inline-flex rounded-full bg-eco-800 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-300">Simulador de impacto</span>
                  <h2 className="mt-4 text-2xl font-extrabold sm:text-3xl">Quanto sua casa pode reciclar?</h2>
                  <p className="mt-2 text-sm leading-relaxed text-emerald-100/75">Ajuste o número de moradores para visualizar uma estimativa mensal.</p>
                  <label htmlFor="people-count" className="mt-7 block text-sm font-bold text-emerald-100">Pessoas na residência</label>
                  <div className="mt-3 flex items-center gap-4">
                    <input id="people-count" type="range" min="1" max="8" value={peopleCount} aria-valuetext={`${peopleCount} ${peopleCount === 1 ? 'pessoa' : 'pessoas'}`} onChange={e => setPeopleCount(parseInt(e.target.value))} className="h-3 w-full cursor-pointer appearance-none rounded-lg bg-eco-800 accent-emerald-400" />
                    <output htmlFor="people-count" className="min-w-24 rounded-xl bg-eco-800 px-3 py-2 text-center text-sm font-extrabold text-emerald-300">{peopleCount} {peopleCount === 1 ? 'pessoa' : 'pessoas'}</output>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-px bg-eco-800 lg:col-span-5 lg:grid-cols-1">
                  {[
                    [`${peopleCount * 12} kg`, 'Recicláveis por mês'],
                    [`${Math.round((peopleCount * 12) * 1.5)} kg`, 'CO₂ evitado por mês'],
                    [`${Math.max(1, Math.round((peopleCount * 12) / 18))}`, 'Árvores em equivalência']
                  ].map(([value, label], index) => (
                    <div key={label} className={`${index === 2 ? 'col-span-2 lg:col-span-1' : ''} flex flex-col justify-center bg-eco-800/60 p-5 sm:p-6`}>
                      <p className={`text-2xl font-extrabold ${index === 1 ? 'text-sun' : 'text-white'}`}>{value}</p>
                      <p className="mt-1 text-xs font-semibold text-emerald-200">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-12">
              <h2 className="text-2xl font-extrabold text-eco-900">Benefícios para toda a cidade</h2>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { icon: Clock, color: 'text-eco-600', bg: 'bg-emerald-100', title: 'Mais previsibilidade', text: 'O cidadão sabe quando a coleta passa e organiza melhor o descarte.' },
                  { icon: Zap, color: 'text-ecoblue-600', bg: 'bg-ecoblue-100', title: 'Resposta mais rápida', text: 'Relatos organizados ajudam equipes a priorizar regiões críticas.' },
                  { icon: Users, color: 'text-purple-600', bg: 'bg-purple-100', title: 'Catadores valorizados', text: 'Cooperativas ganham visibilidade e recebem materiais mais adequados.' },
                  { icon: BarChart3, color: 'text-amber-700', bg: 'bg-amber-100', title: 'Gestão eficiente', text: 'Dados por bairro apoiam decisões de coleta e uso de recursos.' },
                  { icon: ShieldCheck, color: 'text-eco-600', bg: 'bg-emerald-100', title: 'Mais transparência', text: 'Protocolos e status aproximam cidadãos da resposta municipal.', col: 'sm:col-span-2 lg:col-span-1' }
                ].map(item => (
                  <article key={item.title} className={`rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ${item.col || ''}`}>
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${item.bg} ${item.color}`}><item.icon className="h-5 w-5" /></div>
                    <h3 className="mt-4 text-lg font-extrabold text-eco-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.text}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-start justify-between gap-5 rounded-3xl border border-ecoblue-100 bg-ecoblue-50 p-6 sm:flex-row sm:items-center sm:p-8">
              <div><h2 className="text-xl font-extrabold text-eco-900">Pronto para fazer sua parte?</h2><p className="mt-1 text-sm text-slate-600">Encontre o local certo para seus resíduos.</p></div>
              <button type="button" onClick={() => navigateTo('ecopontos')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ecoblue-600 px-5 text-sm font-extrabold text-white hover:bg-ecoblue-700"><MapPin className="h-4 w-4" /> Encontrar EcoPonto</button>
            </div>
          </section>
        )}

        {/* LOGIN SERVIDOR */}
        {currentPage === 'login' && (
          <section className="urban-grid flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-6">
            <LoginBrand />
            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl shadow-emerald-900/5 sm:p-8">
              <div className="flex justify-center mb-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-eco-50 text-eco-600">
                  <Lock className="h-8 w-8" />
                </div>
              </div>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-extrabold text-eco-900">Acesso Restrito</h1>
                <p className="text-sm text-slate-500 mt-2">Ambiente de gestão operacional do EcoRecife.</p>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); enterManagement(); }} className="space-y-5">
                <div>
                  <label htmlFor="management-user" className="block text-sm font-bold text-eco-900 mb-1.5">Matrícula ou e-mail</label>
                  <input id="management-user" type="text" required defaultValue="servidor.teste" placeholder="Digite sua credencial" className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-eco-600 focus:ring-2 focus:ring-emerald-100" />
                </div>
                <div>
                  <label htmlFor="management-password" className="block text-sm font-bold text-eco-900 mb-1.5">Senha</label>
                  <input id="management-password" type="password" required defaultValue="123456" placeholder="••••••••" className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-eco-600 focus:ring-2 focus:ring-emerald-100" />
                </div>
                <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-eco-600 text-base font-extrabold text-white shadow-lg hover:bg-eco-700">
                  Entrar no Sistema <ChevronRight className="h-4 w-4" />
                </button>
              </form>
            </div>
            <button type="button" onClick={() => navigateTo('inicio')} className="mt-6 min-h-10 rounded-xl px-4 text-sm font-bold text-eco-700 hover:bg-white">← Voltar ao portal</button>
          </section>
        )}

        {/* GESTÃO */}
        {currentPage === 'gestao' && (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 mx-auto max-w-7xl px-4 sm:px-6 py-10">
            <div className="mb-8">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700 uppercase tracking-wider mb-2">
                  <AlertOctagon className="h-3.5 w-3.5" /> Nível de Alerta Ativo
                </span>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-eco-900">Painel Operacional</h1>
                <p className="text-sm text-slate-600 mt-2">Monitoramento de eficiência de rotas baseado em denúncias cidadãs.</p>
              </div>
            </div>

            <div className="inline-flex w-full sm:w-auto rounded-2xl bg-eco-900 p-1.5 mb-8 shadow-sm">
              <button type="button" onClick={() => setManagementView('ocorrencias')} className={`flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${managementView === 'ocorrencias' ? 'bg-white text-eco-900 shadow-sm' : 'text-emerald-100 hover:text-white'}`}>
                <ClipboardList className="h-4 w-4" /> Central de Ocorrências
              </button>
              <button type="button" onClick={() => setManagementView('visao-geral')} className={`flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${managementView === 'visao-geral' ? 'bg-white text-eco-900 shadow-sm' : 'text-emerald-100 hover:text-white'}`}>
                <BarChart3 className="h-4 w-4" /> Visão Geral
              </button>
            </div>

            {managementView === 'ocorrencias' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
                  {[
                    { label: 'Recebidas', value: occurrences.filter(item => item.status === 'Recebida').length, icon: ClipboardList, color: 'text-ecoblue-700', bg: 'bg-ecoblue-50' },
                    { label: 'Urgentes', value: occurrences.filter(item => item.priority === 'Urgente' && item.status !== 'Concluída').length, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
                    { label: 'Em atendimento', value: occurrences.filter(item => ['Em análise', 'Equipe designada'].includes(item.status)).length, icon: Truck, color: 'text-amber-700', bg: 'bg-amber-50' },
                    { label: 'Concluídas', value: completedOccurrences.length, icon: CheckCircle, color: 'text-eco-600', bg: 'bg-emerald-50' }
                  ].map(item => (
                    <div key={item.label} className="rounded-2xl border border-emerald-100 bg-white p-4 sm:p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                          <p className="mt-2 text-3xl font-extrabold text-eco-900">{item.value}</p>
                        </div>
                        <div className={`rounded-xl p-2.5 ${item.bg} ${item.color}`}><item.icon className="h-5 w-5" /></div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm sm:p-6">
                  <div className="mb-5 flex rounded-xl bg-slate-100 p-1" aria-label="Visualizar fila ou histórico">
                    <button
                      type="button"
                      onClick={() => { setOccurrenceQueueView('ativas'); setOccurrenceStatusFilter('Todos'); }}
                      className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-extrabold transition ${occurrenceQueueView === 'ativas' ? 'bg-white text-eco-900 shadow-sm' : 'text-slate-500 hover:text-eco-900'}`}
                    >
                      Fila ativa <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{activeOccurrences.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setOccurrenceQueueView('historico'); setOccurrenceStatusFilter('Todos'); }}
                      className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-extrabold transition ${occurrenceQueueView === 'historico' ? 'bg-white text-eco-900 shadow-sm' : 'text-slate-500 hover:text-eco-900'}`}
                    >
                      Histórico <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-eco-700">{completedOccurrences.length}</span>
                    </button>
                  </div>
                  <div className="mb-5 flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5 text-eco-600" />
                    <div>
                      <h2 className="font-bold text-eco-900">Localizar ocorrências</h2>
                      <p className="text-xs text-slate-500">Filtre {occurrenceQueueView === 'ativas' ? 'a fila ativa' : 'o histórico'} por protocolo, local ou andamento.</p>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-12">
                    <div className="relative md:col-span-6">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input value={occurrenceSearch} onChange={event => setOccurrenceSearch(event.target.value)} type="search" placeholder="Buscar protocolo, endereço, bairro..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-eco-600 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
                    </div>
                    <select value={occurrenceNeighborhoodFilter} onChange={event => setOccurrenceNeighborhoodFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-eco-600 md:col-span-3">
                      <option>Todos</option>
                      {neighborhoodSummary.map(item => <option key={item.neighborhood}>{item.neighborhood}</option>)}
                    </select>
                    <select value={occurrenceStatusFilter} onChange={event => setOccurrenceStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-eco-600 md:col-span-3">
                      {(occurrenceQueueView === 'ativas'
                        ? ['Todos', 'Recebida', 'Em análise', 'Equipe designada']
                        : ['Todos', 'Concluída']
                      ).map(status => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
                  <aside className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm lg:col-span-4 lg:sticky lg:top-24">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-2 font-bold text-eco-900"><Building2 className="h-5 w-5 text-eco-600" /> Demanda por bairro</h2>
                        <p className="mt-1 text-xs text-slate-500">Ocorrências ainda não concluídas.</p>
                      </div>
                      {occurrenceNeighborhoodFilter !== 'Todos' && (
                        <button type="button" onClick={() => setOccurrenceNeighborhoodFilter('Todos')} className="text-xs font-bold text-eco-600 hover:text-eco-800">Limpar</button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {neighborhoodSummary.map((item, index) => (
                        <button type="button" key={item.neighborhood} onClick={() => setOccurrenceNeighborhoodFilter(item.neighborhood)} className={`w-full rounded-2xl border p-3.5 text-left transition-all ${occurrenceNeighborhoodFilter === item.neighborhood ? 'border-eco-600 bg-emerald-50 shadow-sm' : 'border-slate-100 hover:border-emerald-200 hover:bg-slate-50'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-extrabold ${index < 2 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{index + 1}</span>
                              <div>
                                <p className="text-sm font-bold text-eco-900">{item.neighborhood}</p>
                                <p className="text-[11px] text-slate-500">{item.total} {item.total === 1 ? 'registro' : 'registros'} no total</p>
                              </div>
                            </div>
                            <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-extrabold text-red-600">{item.pending}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </aside>

                  <div className="space-y-3 lg:col-span-8">
                    <div className="flex items-center justify-between gap-4 px-1">
                      <div>
                        <h2 className="font-bold text-eco-900">{occurrenceQueueView === 'ativas' ? 'Fila de atendimento' : 'Histórico de concluídas'}</h2>
                        <p className="text-xs text-slate-500">{filteredOccurrences.length} {filteredOccurrences.length === 1 ? 'ocorrência encontrada' : 'ocorrências encontradas'}</p>
                      </div>
                      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm border border-slate-100"><CircleDot className="h-3.5 w-3.5 text-eco-500" /> Atualizado agora</span>
                    </div>

                    {filteredOccurrences.map(occurrence => (
                      <article key={occurrence.id} className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm transition hover:border-emerald-200 hover:shadow-md">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-extrabold tracking-wide text-eco-600">{occurrence.protocol}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${occurrence.priority === 'Urgente' ? 'bg-red-100 text-red-700' : occurrence.priority === 'Alta' ? 'bg-amber-100 text-amber-800' : occurrence.priority === 'Média' ? 'bg-ecoblue-50 text-ecoblue-700' : 'bg-slate-100 text-slate-600'}`}>{occurrence.priority}</span>
                            </div>
                            <h3 className="mt-2 text-lg font-extrabold text-eco-900">{occurrence.type}</h3>
                            <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ecoblue-600" /> {occurrence.address} · {occurrence.neighborhood}</p>
                            <p className="mt-3 text-sm leading-relaxed text-slate-600">{occurrence.description}</p>
                            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400"><Clock className="h-3.5 w-3.5" /> Recebida {occurrence.reportedAt.toLocaleLowerCase('pt-BR')}</p>
                            {occurrence.status === 'Concluída' && (
                              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                                <p className="flex items-center gap-1.5 text-xs font-bold text-eco-700"><CheckCircle className="h-3.5 w-3.5" /> Concluída {occurrence.completedAt ? `em ${occurrence.completedAt}` : ''}</p>
                                {occurrence.completionNote && <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{occurrence.completionNote}</p>}
                              </div>
                            )}
                            <OccurrencePhotos occurrenceId={occurrence.id} />
                          </div>
                          <div className="w-full shrink-0 sm:w-48">
                            {occurrence.status === 'Concluída' ? (
                              <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-bold text-eco-700"><CheckCircle className="h-3.5 w-3.5" /> Concluída</span>
                            ) : (
                              <>
                                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Andamento</label>
                                <select value={occurrence.status} onChange={event => updateOccurrenceStatus(occurrence.id, event.target.value as OccurrenceStatus)} className={`w-full rounded-xl border px-3 py-2.5 text-xs font-bold outline-none transition focus:ring-2 focus:ring-emerald-100 ${occurrence.status === 'Equipe designada' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                  {['Recebida', 'Em análise', 'Equipe designada'].map(status => <option key={status}>{status}</option>)}
                                </select>
                                <button type="button" onClick={() => setOccurrenceToComplete(occurrence)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-eco-600 px-3 text-xs font-extrabold text-white transition hover:bg-eco-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-600 focus-visible:ring-offset-2">
                                  <CheckCircle className="h-4 w-4" /> Concluir ocorrência
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}

                    {filteredOccurrences.length === 0 && (
                      <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                        <Search className="mx-auto h-9 w-9 text-slate-300" />
                        <h3 className="mt-3 font-bold text-eco-900">Nenhuma ocorrência encontrada</h3>
                        <p className="mt-1 text-sm text-slate-500">{occurrenceQueueView === 'ativas' && activeOccurrences.length === 0 ? 'Todas as ocorrências foram concluídas.' : 'Tente remover um dos filtros ou buscar outro endereço.'}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {managementView === 'visao-geral' && (
              <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-emerald-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-500 text-sm uppercase">Total de Denúncias</h3>
                  <div className="p-2 bg-red-50 text-red-600 rounded-lg"><AlertTriangle className="h-5 w-5" /></div>
                </div>
                <p className="text-4xl font-extrabold text-eco-900">142</p>
                <p className="text-xs font-semibold text-red-500 mt-2 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> +12% esta semana</p>
              </div>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-emerald-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-500 text-sm uppercase">Eficiência de Coleta</h3>
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><PieChart className="h-5 w-5" /></div>
                </div>
                <p className="text-4xl font-extrabold text-eco-900">78%</p>
                <p className="text-xs font-semibold text-emerald-600 mt-2 flex items-center gap-1">Dentro da meta esperada</p>
              </div>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-emerald-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-500 text-sm uppercase">Rotas Comprometidas</h3>
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><MapPin className="h-5 w-5" /></div>
                </div>
                <p className="text-4xl font-extrabold text-eco-900">3</p>
                <p className="text-xs font-semibold text-slate-500 mt-2 flex items-center gap-1">Requerem atenção imediata</p>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-emerald-100 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
                <h2 className="font-bold text-eco-900">Análise Crítica de Rotas</h2>
                <p className="text-xs text-slate-500">Distribuição de relatos de descarte irregular por região</p>
              </div>
              <div className="divide-y divide-slate-100">
                <div className="p-6 flex flex-col md:flex-row items-start md:items-center gap-6 hover:bg-slate-50 transition-colors">
                  <div className="flex-1 w-full">
                    <div className="flex justify-between items-end mb-2">
                      <h4 className="font-bold text-lg text-eco-900">Rota 12 - Boa Viagem / Pina</h4>
                      <span className="font-extrabold text-red-600">45% das denúncias</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-red-500 h-2.5 rounded-full" style={{ width: '45%' }}></div>
                    </div>
                    <p className="text-sm text-slate-600 mt-3 leading-relaxed">Alta incidência de volumosos (móveis) nas calçadas. <strong className="text-eco-700">Ação recomendada:</strong> Aumentar a frequência do caminhão de coleta de grande porte nesta rota de 1x para 2x por semana.</p>
                  </div>
                </div>

                <div className="p-6 flex flex-col md:flex-row items-start md:items-center gap-6 hover:bg-slate-50 transition-colors">
                  <div className="flex-1 w-full">
                    <div className="flex justify-between items-end mb-2">
                      <h4 className="font-bold text-lg text-eco-900">Rota 08 - Casa Amarela</h4>
                      <span className="font-extrabold text-amber-500">28% das denúncias</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-amber-400 h-2.5 rounded-full" style={{ width: '28%' }}></div>
                    </div>
                    <p className="text-sm text-slate-600 mt-3 leading-relaxed">Acúmulo crônico em pontos viciados. <strong className="text-eco-700">Ação recomendada:</strong> Implementar campanha educativa e avaliar instalação de um novo EcoPonto móvel na região.</p>
                  </div>
                </div>

                <div className="p-6 flex flex-col md:flex-row items-start md:items-center gap-6 hover:bg-slate-50 transition-colors">
                  <div className="flex-1 w-full">
                    <div className="flex justify-between items-end mb-2">
                      <h4 className="font-bold text-lg text-eco-900">Rota 05 - Centro Histórico</h4>
                      <span className="font-extrabold text-eco-600">15% das denúncias</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-eco-500 h-2.5 rounded-full" style={{ width: '15%' }}></div>
                    </div>
                    <p className="text-sm text-slate-600 mt-3 leading-relaxed">Lixeiras públicas constantemente lotadas. <strong className="text-eco-700">Ação recomendada:</strong> Substituição por contentores subterrâneos de maior capacidade.</p>
                  </div>
                </div>
              </div>
            </div>
              </>
            )}
          </section>
        )}
      </main>

      <OccurrenceCompletionDialog occurrence={occurrenceToComplete} onCancel={() => setOccurrenceToComplete(null)} onConfirm={completeOccurrence} />
      {isPublicPage && <PublicFooter navigateTo={navigateTo} />}
      {isPublicPage && <PublicMobileNav currentPage={currentPage} navigateTo={navigateTo} />}
    </div>
  );
}
