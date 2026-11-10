// Coleta · simulação (DEMONSTRATIVA): move cada veículo ativo pela sua rota, usando os
// pontos ordenados que GET /api/rotas devolve (seed 002). Não há integração com a frota.
// As funções são puras, sem banco, rede nem dependência; as posições ficam só na memória
// (D8). O relógio fica isolado em criarSimulador (setInterval), que os testes controlam
// com vi.useFakeTimers().
import type { listarRotas } from './coleta.js';

type RotaApi = Awaited<ReturnType<typeof listarRotas>>['itens'][number];
// Só o que a simulação usa de cada rota da API.
export type RotaEntrada = Pick<RotaApi, 'id' | 'pontos'> & {
  veiculo: Pick<NonNullable<RotaApi['veiculo']>, 'codigo'> | null;
};

export const INTERVALO_PADRAO_MS = 3000; // D7
export const INTERVALO_MINIMO_MS = 1000;
export const INTERVALO_MAXIMO_MS = 60_000;
// Velocidade demonstrativa de um caminhão de coleta em rua de bairro (não é dado oficial).
export const VELOCIDADE_PADRAO_KMH = 20;
export const VELOCIDADE_MAXIMA_KMH = 80;

const RAIO_TERRA_KM = 6371.0088; // o mesmo de distancia_km (migração 001)
const TOLERANCIA_FECHADO_KM = 0.001; // início e fim a menos de 1 m: circuito fechado
const SEGMENTO_MINIMO_KM = 1e-9; // pontos consecutivos iguais não formam segmento

export type Coordenada = { latitude: number; longitude: number };

// Haversine, igual à função distancia_km do banco.
export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function coordenadaValida(p: unknown): p is Coordenada {
  if (typeof p !== 'object' || p === null) return false;
  const { latitude, longitude } = p as Record<string, unknown>;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

// ---------------------------------------------------------------------------
// Trajeto: a rota preparada para a simulação (fixa durante toda a execução)
// ---------------------------------------------------------------------------

export type Trajeto = {
  rotaId: number;
  codigo: string;
  pontos: Coordenada[]; // válidos, em ordem, sem repetidos consecutivos
  acumuladoKm: number[]; // distância do início até cada ponto (o primeiro é 0)
  comprimentoKm: number;
  fechado: boolean; // o último ponto coincide com o primeiro
};

export type MotivoIgnorada = 'sem_veiculo' | 'pontos_insuficientes' | 'veiculo_repetido';

export function prepararTrajeto(rota: RotaEntrada): Trajeto | Exclude<MotivoIgnorada, 'veiculo_repetido'> {
  if (!rota.veiculo) return 'sem_veiculo';
  const brutos = Array.isArray(rota.pontos) ? rota.pontos : [];
  const ordenados = brutos
    .filter((p) => coordenadaValida(p) && Number.isFinite(p.ordem))
    .sort((a, b) => a.ordem - b.ordem);

  const pontos: Coordenada[] = [];
  const acumuladoKm: number[] = [];
  for (const { latitude, longitude } of ordenados) {
    const anterior = pontos.at(-1);
    const trecho = anterior ? distanciaKm(anterior, { latitude, longitude }) : 0;
    if (anterior && trecho < SEGMENTO_MINIMO_KM) continue;
    pontos.push({ latitude, longitude });
    acumuladoKm.push((acumuladoKm.at(-1) ?? 0) + trecho);
  }
  const comprimentoKm = acumuladoKm.at(-1) ?? 0;
  if (pontos.length < 2 || !(comprimentoKm > 0)) return 'pontos_insuficientes';

  return {
    rotaId: rota.id,
    codigo: rota.veiculo.codigo,
    pontos,
    acumuladoKm,
    comprimentoKm,
    fechado: distanciaKm(pontos[0]!, pontos.at(-1)!) <= TOLERANCIA_FECHADO_KM,
  };
}

// Ponto a "km" do início, interpolado linearmente no segmento (segmentos curtos, de
// poucas centenas de metros, então a reta entre os dois pontos acompanha a rua).
export function coordenadaNoTrajeto(trajeto: Trajeto, km: number): Coordenada {
  const { pontos, acumuladoKm } = trajeto;
  const d = Math.min(Math.max(km, 0), trajeto.comprimentoKm);
  // Busca binária do último ponto com acumulado <= d (no máximo o penúltimo).
  let ini = 0;
  let fim = pontos.length - 2;
  while (ini < fim) {
    const meio = (ini + fim + 1) >> 1;
    if (acumuladoKm[meio]! <= d) ini = meio;
    else fim = meio - 1;
  }
  const a = pontos[ini]!;
  const b = pontos[ini + 1]!;
  const fracao = Math.min(Math.max((d - acumuladoKm[ini]!) / (acumuladoKm[ini + 1]! - acumuladoKm[ini]!), 0), 1);
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * fracao,
    longitude: a.longitude + (b.longitude - a.longitude) * fracao,
  };
}

// ---------------------------------------------------------------------------
// Estado da simulação (imutável: cada passo devolve um estado novo)
// ---------------------------------------------------------------------------

export type EstadoVeiculo = {
  trajeto: Trajeto;
  percorridoKm: number; // posição na volta atual, de 0 até antes do comprimento
  volta: number; // voltas completas desde o início
};

export type EstadoSimulacao = {
  veiculos: EstadoVeiculo[];
  ignoradas: { rotaId: number; motivo: MotivoIgnorada }[];
};

// Cada veículo começa no primeiro ponto da sua rota. Rotas sem veículo, com menos de dois
// pontos válidos ou de um veículo que já tem rota são ignoradas, sem afetar as demais.
export function iniciarSimulacao(rotas: readonly RotaEntrada[]): EstadoSimulacao {
  const veiculos: EstadoVeiculo[] = [];
  const ignoradas: EstadoSimulacao['ignoradas'] = [];
  const codigos = new Set<string>();
  for (const rota of rotas) {
    const trajeto = prepararTrajeto(rota);
    if (typeof trajeto === 'string') {
      ignoradas.push({ rotaId: rota.id, motivo: trajeto });
    } else if (codigos.has(trajeto.codigo)) {
      ignoradas.push({ rotaId: rota.id, motivo: 'veiculo_repetido' });
    } else {
      codigos.add(trajeto.codigo);
      veiculos.push({ trajeto, percorridoKm: 0, volta: 0 });
    }
  }
  return { veiculos, ignoradas };
}

// Avança todos os veículos a mesma distância. Ao passar do fim, recomeça do início e
// carrega o que sobrou, para não perder nem repetir trecho. Num circuito fechado (todas
// as rotas do seed 002) o fim é o próprio início, então a volta não tem salto.
export function avancar(estado: EstadoSimulacao, km: number): EstadoSimulacao {
  if (!Number.isFinite(km) || km < 0) throw new RangeError('A distância do passo deve ser um número >= 0');
  return {
    ...estado,
    veiculos: estado.veiculos.map((v) => {
      const total = v.percorridoKm + km;
      const resto = total % v.trajeto.comprimentoKm;
      return { ...v, percorridoKm: resto, volta: v.volta + Math.round((total - resto) / v.trajeto.comprimentoKm) };
    }),
  };
}

export type Posicao = {
  codigo: string;
  rotaId: number;
  latitude: number;
  longitude: number;
  volta: number;
  demonstrativo: true; // posição simulada, nunca da frota real
};

export function posicoes(estado: EstadoSimulacao): Posicao[] {
  return estado.veiculos.map(({ trajeto, percorridoKm, volta }) => ({
    codigo: trajeto.codigo,
    rotaId: trajeto.rotaId,
    ...coordenadaNoTrajeto(trajeto, percorridoKm),
    volta,
    demonstrativo: true,
  }));
}

export function kmPorPasso(velocidadeKmh: number, intervaloMs: number): number {
  return (velocidadeKmh * intervaloMs) / 3_600_000;
}

// ---------------------------------------------------------------------------
// Relógio: avança o estado a cada intervalo (padrão 3 s) e avisa quem estiver ouvindo
// ---------------------------------------------------------------------------

export type OpcoesSimulador = {
  intervaloMs?: number;
  velocidadeKmh?: number;
  aoAvancar?: (posicoes: Posicao[]) => void;
};

export function criarSimulador(rotas: readonly RotaEntrada[], opcoes: OpcoesSimulador = {}) {
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS;
  const velocidadeKmh = opcoes.velocidadeKmh ?? VELOCIDADE_PADRAO_KMH;
  if (!Number.isInteger(intervaloMs) || intervaloMs < INTERVALO_MINIMO_MS || intervaloMs > INTERVALO_MAXIMO_MS) {
    throw new RangeError(`O intervalo deve ser um inteiro de ${INTERVALO_MINIMO_MS} a ${INTERVALO_MAXIMO_MS} ms`);
  }
  if (!Number.isFinite(velocidadeKmh) || velocidadeKmh <= 0 || velocidadeKmh > VELOCIDADE_MAXIMA_KMH) {
    throw new RangeError(`A velocidade deve ser maior que 0 e no máximo ${VELOCIDADE_MAXIMA_KMH} km/h`);
  }
  const passoKm = kmPorPasso(velocidadeKmh, intervaloMs);
  let estado = iniciarSimulacao(rotas);
  let relogio: ReturnType<typeof setInterval> | undefined;

  // Cada passo vale um intervalo fixo, então o resultado não depende de atrasos do relógio.
  const passo = () => {
    estado = avancar(estado, passoKm);
    opcoes.aoAvancar?.(posicoes(estado));
  };

  return {
    intervaloMs,
    passoKm,
    ignoradas: estado.ignoradas,
    posicoes: () => posicoes(estado),
    get ativo() {
      return relogio !== undefined;
    },
    iniciar() {
      if (relogio) return; // chamar de novo não cria um segundo relógio
      relogio = setInterval(passo, intervaloMs);
      relogio.unref(); // o relógio sozinho não mantém o processo vivo
    },
    parar() {
      clearInterval(relogio);
      relogio = undefined;
    },
  };
}
