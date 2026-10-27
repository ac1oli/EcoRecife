export type Page = 'inicio' | 'coleta' | 'zeladoria' | 'ecopontos' | 'beneficios' | 'login' | 'gestao';
export type ManagementView = 'ocorrencias' | 'visao-geral';
export type OccurrenceStatus = 'Recebida' | 'Em análise' | 'Equipe designada' | 'Concluída';
export type OccurrencePriority = 'Urgente' | 'Alta' | 'Média' | 'Baixa';

export type Occurrence = {
  id: number;
  protocol: string;
  type: string;
  neighborhood: string;
  address: string;
  description: string;
  reportedAt: string;
  status: OccurrenceStatus;
  priority: OccurrencePriority;
  completedAt?: string;
  completionNote?: string;
};

export type MapLocation = {
  id: number;
  type: 'truck' | 'eco' | 'coop' | 'search';
  name: string;
  neighborhood: string;
  coords: [number, number];
  status: string;
  time: string;
  update: string;
  color: string;
};
