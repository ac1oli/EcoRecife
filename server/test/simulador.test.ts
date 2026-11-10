// Motor da simulação da coleta (src/coleta/simulador.ts): funções puras, sem banco nem
// rede. O relógio é controlado com os timers falsos do Vitest. Também roda sobre as 7
// rotas reais do seed 002, lidas do arquivo SQL.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  avancar,
  coordenadaNoTrajeto,
  criarSimulador,
  distanciaKm,
  INTERVALO_PADRAO_MS,
  iniciarSimulacao,
  kmPorPasso,
  posicoes,
  prepararTrajeto,
  type EstadoSimulacao,
  type Posicao,
  type RotaEntrada,
  type Trajeto,
  VELOCIDADE_PADRAO_KMH,
} from '../src/coleta/simulador.js';
import { lerSeedRotas } from './apoio/seed-rotas.js';

// Pontos ao longo de um meridiano perto do Recife: cada 0,001° de latitude ≈ 111,195 m.
const KM_POR_MILESIMO = (Math.PI * 6371.0088) / 180 / 1000;
const ponto = (ordem: number, latitude: number, longitude = -34.9) => ({ ordem, latitude, longitude });
const rota = (id: number, codigo: string | null, pontos: RotaEntrada['pontos']): RotaEntrada => ({
  id,
  veiculo: codigo === null ? null : { codigo },
  pontos,
});
// Linha aberta de 3 pontos (2 segmentos) e um quadrado fechado (início = fim).
const LINHA = rota(1, '#04', [ponto(1, -8.0), ponto(2, -8.001), ponto(3, -8.002)]);
const QUADRADO = rota(2, '#06', [
  ponto(1, -8.0, -34.9),
  ponto(2, -8.001, -34.9),
  ponto(3, -8.001, -34.901),
  ponto(4, -8.0, -34.901),
  ponto(5, -8.0, -34.9),
]);

const trajeto = (r: RotaEntrada) => prepararTrajeto(r) as Trajeto;
const posicaoValida = (p: Posicao) =>
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180 &&
  Number.isInteger(p.volta) &&
  p.volta >= 0;
// Tolerância de 1 mm: a interpolação é linear em lat/lng, e a régua é Haversine.
const TOLERANCIA_KM = 1e-6;
const estadoConsistente = (estado: EstadoSimulacao) =>
  estado.veiculos.every(
    (v) => Number.isFinite(v.percorridoKm) && v.percorridoKm >= 0 && v.percorridoKm < v.trajeto.comprimentoKm,
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('distância (Haversine, igual a distancia_km)', () => {
  it('1° de latitude ≈ 111,195 km e distância de um ponto a ele mesmo é 0', () => {
    expect(distanciaKm({ latitude: -8, longitude: -34.9 }, { latitude: -9, longitude: -34.9 })).toBeCloseTo(111.195, 3);
    expect(distanciaKm({ latitude: -8.05, longitude: -34.9 }, { latitude: -8.05, longitude: -34.9 })).toBe(0);
  });
});

describe('preparação das rotas', () => {
  it('ordena pelos campos ordem, mede os segmentos e detecta circuito fechado', () => {
    const t = trajeto(rota(1, '#04', [ponto(3, -8.002), ponto(1, -8.0), ponto(2, -8.001)]));
    expect(t.pontos.map((p) => p.latitude)).toEqual([-8.0, -8.001, -8.002]);
    expect(t.acumuladoKm[0]).toBe(0);
    expect(t.acumuladoKm[1]).toBeCloseTo(KM_POR_MILESIMO, 9);
    expect(t.comprimentoKm).toBeCloseTo(2 * KM_POR_MILESIMO, 9);
    expect(t.fechado).toBe(false);
    expect(trajeto(QUADRADO).fechado).toBe(true);
    expect(trajeto(QUADRADO).comprimentoKm).toBeGreaterThan(0.4);
  });

  it.each([
    ['sem pontos', []],
    ['um ponto', [ponto(1, -8.0)]],
    ['dois pontos iguais', [ponto(1, -8.0), ponto(2, -8.0)]],
    ['um ponto válido e outros inválidos', [ponto(1, -8.0), ponto(2, NaN), ponto(3, -8.0, Infinity), ponto(4, 91)]],
    ['longitude fora do intervalo', [ponto(1, -8.0, -181), ponto(2, -8.001, 200)]],
    ['ordem inválida', [ponto(NaN, -8.0), ponto(Number.NaN, -8.001)]],
    ['tipos errados', [{ ordem: 1, latitude: '-8', longitude: '-34.9' }, null] as never],
  ])('%s: rota ignorada (pontos_insuficientes)', (_, pontos) => {
    expect(prepararTrajeto(rota(9, '#20', pontos))).toBe('pontos_insuficientes');
  });

  it('pontos inválidos e repetidos consecutivos são descartados, sem invalidar a rota', () => {
    const t = trajeto(rota(1, '#04', [ponto(1, -8.0), ponto(2, -8.0), ponto(3, NaN), ponto(4, -8.001), ponto(5, -8.001)]));
    expect(t.pontos).toEqual([
      { latitude: -8.0, longitude: -34.9 },
      { latitude: -8.001, longitude: -34.9 },
    ]);
  });

  it('rota sem veículo é ignorada; pontos que não são lista não quebram', () => {
    expect(prepararTrajeto(rota(1, null, LINHA.pontos))).toBe('sem_veiculo');
    expect(prepararTrajeto({ id: 1, veiculo: { codigo: '#04' }, pontos: undefined as never })).toBe('pontos_insuficientes');
  });
});

describe('inicialização', () => {
  it('cada veículo começa no primeiro ponto da sua rota, na volta 0', () => {
    const estado = iniciarSimulacao([LINHA, QUADRADO]);
    expect(posicoes(estado)).toEqual([
      { codigo: '#04', rotaId: 1, latitude: -8.0, longitude: -34.9, volta: 0, demonstrativo: true },
      { codigo: '#06', rotaId: 2, latitude: -8.0, longitude: -34.9, volta: 0, demonstrativo: true },
    ]);
    expect(estado.ignoradas).toEqual([]);
  });

  it('rotas inválidas são listadas em ignoradas e não afetam as demais', () => {
    const estado = iniciarSimulacao([
      rota(10, null, LINHA.pontos),
      LINHA,
      rota(11, '#08', [ponto(1, -8.0)]),
      rota(12, '#04', QUADRADO.pontos), // o #04 já tem rota
      QUADRADO,
    ]);
    expect(estado.veiculos.map((v) => v.trajeto.codigo)).toEqual(['#04', '#06']);
    expect(estado.ignoradas).toEqual([
      { rotaId: 10, motivo: 'sem_veiculo' },
      { rotaId: 11, motivo: 'pontos_insuficientes' },
      { rotaId: 12, motivo: 'veiculo_repetido' },
    ]);
    const depois = avancar(estado, 0.05);
    expect(posicoes(depois).every(posicaoValida)).toBe(true);
  });

  it('sem nenhuma rota válida, a simulação fica vazia (sem erro)', () => {
    const estado = iniciarSimulacao([rota(1, null, []), rota(2, '#04', [])]);
    expect(posicoes(avancar(estado, 1))).toEqual([]);
  });
});

describe('movimento', () => {
  it('interpola dentro do segmento: no meio do primeiro trecho, a meia distância dos dois pontos', () => {
    const t = trajeto(LINHA);
    const meio = coordenadaNoTrajeto(t, KM_POR_MILESIMO / 2);
    expect(meio.latitude).toBeCloseTo(-8.0005, 9);
    expect(meio.longitude).toBe(-34.9);
    expect(coordenadaNoTrajeto(t, KM_POR_MILESIMO).latitude).toBeCloseTo(-8.001, 9);
    expect(coordenadaNoTrajeto(t, KM_POR_MILESIMO * 1.25).latitude).toBeCloseTo(-8.00125, 9);
    // Fora do trajeto, fica nas pontas (nunca extrapola).
    expect(coordenadaNoTrajeto(t, -1)).toEqual({ latitude: -8.0, longitude: -34.9 });
    expect(coordenadaNoTrajeto(t, 99).latitude).toBeCloseTo(-8.002, 9);
  });

  it('avança de um ponto para o seguinte, passando pelo ponto intermediário sem pular', () => {
    let estado = iniciarSimulacao([LINHA]);
    const latitudes: number[] = [];
    for (let i = 0; i < 7; i++) {
      estado = avancar(estado, KM_POR_MILESIMO / 4);
      latitudes.push(posicoes(estado)[0]!.latitude);
    }
    [-8.00025, -8.0005, -8.00075, -8.001, -8.00125, -8.0015, -8.00175].forEach((esperada, i) =>
      expect(latitudes[i]).toBeCloseTo(esperada, 9),
    );
  });

  it('é imutável: avancar devolve um estado novo e não mexe no anterior', () => {
    const inicial = iniciarSimulacao([LINHA]);
    const depois = avancar(inicial, 0.05);
    expect(inicial.veiculos[0]!.percorridoKm).toBe(0);
    expect(depois.veiculos[0]!.percorridoKm).toBeCloseTo(0.05, 12);
    expect(depois.veiculos[0]!.trajeto).toBe(inicial.veiculos[0]!.trajeto);
  });

  it('passo zero não move; passo negativo ou não finito é recusado', () => {
    const estado = iniciarSimulacao([LINHA]);
    expect(posicoes(avancar(estado, 0))).toEqual(posicoes(estado));
    for (const km of [-0.1, NaN, Infinity]) expect(() => avancar(estado, km)).toThrow(RangeError);
  });

  it('continuidade: a cada passo, a posição anda no máximo o tamanho do passo', () => {
    let estado = iniciarSimulacao([QUADRADO]);
    const passo = 0.013;
    let anterior = posicoes(estado)[0]!;
    for (let i = 0; i < 200; i++) {
      estado = avancar(estado, passo);
      const atual = posicoes(estado)[0]!;
      expect(distanciaKm(anterior, atual)).toBeLessThanOrEqual(passo + TOLERANCIA_KM);
      anterior = atual;
    }
  });
});

describe('fim do trajeto e reinício', () => {
  it('circuito fechado: passa do fim para o começo sem salto e conta a volta', () => {
    const t = trajeto(QUADRADO);
    let estado = iniciarSimulacao([QUADRADO]);
    estado = avancar(estado, t.comprimentoKm - 0.01);
    const antes = posicoes(estado)[0]!;
    estado = avancar(estado, 0.02);
    const depois = posicoes(estado)[0]!;
    expect(depois.volta).toBe(1);
    expect(estado.veiculos[0]!.percorridoKm).toBeCloseTo(0.01, 9);
    expect(distanciaKm(antes, depois)).toBeLessThanOrEqual(0.02 + TOLERANCIA_KM);
    expect(estadoConsistente(estado)).toBe(true);
  });

  it('chegar exatamente ao fim já é o início da volta seguinte', () => {
    const t = trajeto(QUADRADO);
    const estado = avancar(iniciarSimulacao([QUADRADO]), t.comprimentoKm);
    expect(estado.veiculos[0]!.percorridoKm).toBe(0);
    expect(posicoes(estado)[0]).toMatchObject({ latitude: -8.0, longitude: -34.9, volta: 1 });
  });

  it('rota aberta: ao chegar ao fim, recomeça do primeiro ponto com o restante do passo', () => {
    const t = trajeto(LINHA);
    const estado = avancar(iniciarSimulacao([LINHA]), t.comprimentoKm + KM_POR_MILESIMO / 2);
    expect(posicoes(estado)[0]!.latitude).toBeCloseTo(-8.0005, 9);
    expect(posicoes(estado)[0]!.volta).toBe(1);
  });

  it('passo maior que várias voltas: conta todas e continua dentro do trajeto', () => {
    const t = trajeto(QUADRADO);
    const estado = avancar(iniciarSimulacao([QUADRADO]), t.comprimentoKm * 3.5);
    expect(estado.veiculos[0]!.volta).toBe(3);
    expect(estado.veiculos[0]!.percorridoKm).toBeCloseTo(t.comprimentoKm / 2, 9);
    expect(estadoConsistente(estado)).toBe(true);
  });

  it('muitas voltas acumuladas não geram NaN nem estado fora do trajeto', () => {
    let estado = iniciarSimulacao([LINHA, QUADRADO]);
    for (let i = 0; i < 5000; i++) estado = avancar(estado, 0.0377);
    expect(estadoConsistente(estado)).toBe(true);
    expect(posicoes(estado).every(posicaoValida)).toBe(true);
    expect(estado.veiculos.every((v) => v.volta > 100)).toBe(true);
  });
});

describe('relógio (timers falsos do Vitest)', () => {
  it('padrão: 3 s por passo, 20 km/h (≈ 16,7 m por passo)', () => {
    const sim = criarSimulador([QUADRADO]);
    expect(INTERVALO_PADRAO_MS).toBe(3000);
    expect(sim.intervaloMs).toBe(3000);
    expect(sim.passoKm).toBeCloseTo(kmPorPasso(VELOCIDADE_PADRAO_KMH, 3000), 12);
    expect(sim.passoKm).toBeCloseTo(0.016667, 6);
  });

  it('só avança quando o relógio chega a cada intervalo e avisa com as posições', () => {
    vi.useFakeTimers();
    const avisos: Posicao[][] = [];
    const sim = criarSimulador([LINHA, QUADRADO], { aoAvancar: (p) => avisos.push(p) });
    sim.iniciar();
    expect(sim.ativo).toBe(true);
    vi.advanceTimersByTime(2999);
    expect(avisos).toHaveLength(0);
    expect(sim.posicoes()[0]!.latitude).toBe(-8.0);
    vi.advanceTimersByTime(1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toEqual(sim.posicoes());
    vi.advanceTimersByTime(3000 * 9);
    expect(avisos).toHaveLength(10);
    // 10 passos de 3 s a 20 km/h = 166,7 m: o #04 já passou do 1º ponto intermediário.
    const linha = sim.posicoes()[0]!;
    expect(distanciaKm({ latitude: -8.0, longitude: -34.9 }, linha)).toBeCloseTo(10 * sim.passoKm, 6);
    sim.parar();
  });

  it('parar interrompe; iniciar de novo continua de onde parou; iniciar duas vezes não duplica', () => {
    vi.useFakeTimers();
    let avisos = 0;
    const sim = criarSimulador([QUADRADO], { aoAvancar: () => avisos++ });
    sim.iniciar();
    sim.iniciar();
    vi.advanceTimersByTime(3000 * 4);
    expect(avisos).toBe(4);
    sim.parar();
    expect(sim.ativo).toBe(false);
    const parado = sim.posicoes();
    vi.advanceTimersByTime(60_000);
    expect(avisos).toBe(4);
    expect(sim.posicoes()).toEqual(parado);
    sim.iniciar();
    vi.advanceTimersByTime(3000);
    expect(avisos).toBe(5);
    sim.parar();
    sim.parar(); // parar de novo não dá erro
  });

  it('respeita intervalo e velocidade configurados', () => {
    vi.useFakeTimers();
    let avisos = 0;
    const sim = criarSimulador([QUADRADO], { intervaloMs: 1000, velocidadeKmh: 36, aoAvancar: () => avisos++ });
    expect(sim.passoKm).toBeCloseTo(0.01, 12); // 36 km/h = 10 m/s
    sim.iniciar();
    vi.advanceTimersByTime(5000);
    expect(avisos).toBe(5);
    sim.parar();
  });

  it.each([
    [{ intervaloMs: 0 }],
    [{ intervaloMs: 999 }],
    [{ intervaloMs: 60_001 }],
    [{ intervaloMs: 1500.5 }],
    [{ intervaloMs: NaN }],
    [{ velocidadeKmh: 0 }],
    [{ velocidadeKmh: -5 }],
    [{ velocidadeKmh: 81 }],
    [{ velocidadeKmh: Infinity }],
  ])('configuração inválida %o é recusada', (opcoes) => {
    expect(() => criarSimulador([QUADRADO], opcoes)).toThrow(RangeError);
  });

  it('expõe as rotas ignoradas para quem montar o simulador', () => {
    const sim = criarSimulador([QUADRADO, rota(30, '#13', [ponto(1, -8.0)])]);
    expect(sim.ignoradas).toEqual([{ rotaId: 30, motivo: 'pontos_insuficientes' }]);
    expect(sim.posicoes().map((p) => p.codigo)).toEqual(['#06']);
  });
});

describe('com as 7 rotas do seed 002', () => {
  let rotas: RotaEntrada[];
  beforeAll(async () => {
    const seed = await lerSeedRotas();
    let id = 0;
    rotas = [...seed.pontos].map(([codigo, pontos]) => rota(++id, codigo, pontos.map(({ ordem, latitude, longitude }) => ({ ordem, latitude, longitude }))));
  });

  it('todas as rotas viram trajetos fechados, sem nenhuma ignorada', () => {
    const estado = iniciarSimulacao(rotas);
    expect(estado.veiculos).toHaveLength(7);
    expect(estado.ignoradas).toEqual([]);
    for (const v of estado.veiculos) {
      expect(v.trajeto.fechado).toBe(true);
      // Os trajetos têm de 4,2 a 6,2 km (docs/03, seção 5.1).
      expect(v.trajeto.comprimentoKm).toBeGreaterThan(4);
      expect(v.trajeto.comprimentoKm).toBeLessThan(6.5);
    }
  });

  it('7 veículos ao mesmo tempo, uma volta completa e mais: sem saltos, NaN ou estado fora do trajeto', () => {
    vi.useFakeTimers();
    const sim = criarSimulador(rotas);
    const inicio = sim.posicoes();
    let anteriores = inicio;
    let maiorDeslocamento = 0;
    let passos = 0;
    sim.iniciar();
    // A rota mais longa (≈ 6,2 km) leva ≈ 373 passos a 20 km/h; 450 passos garantem a volta.
    for (; passos < 450; passos++) {
      vi.advanceTimersByTime(INTERVALO_PADRAO_MS);
      const atuais = sim.posicoes();
      expect(atuais.map((p) => p.codigo)).toEqual(inicio.map((p) => p.codigo));
      for (const [i, p] of atuais.entries()) {
        expect(posicaoValida(p)).toBe(true);
        maiorDeslocamento = Math.max(maiorDeslocamento, distanciaKm(anteriores[i]!, p));
      }
      anteriores = atuais;
    }
    sim.parar();
    expect(maiorDeslocamento).toBeLessThanOrEqual(sim.passoKm + TOLERANCIA_KM);
    expect(anteriores.every((p) => p.volta === 1)).toBe(true);
    // Cada caminhão continua perto do seu bairro (no máximo ≈ 1 km do trajeto ao centro).
    for (const [i, p] of anteriores.entries()) expect(distanciaKm(inicio[i]!, p)).toBeLessThan(2.5);
  });
});
