// /api/veiculos e /api/rotas com um banco falso (sem PostgreSQL): acesso público,
// campos expostos, filtro de ativos no SQL, ausência de escrita e erros.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../src/app.js';
import { criarArmazenamentoDisco } from '../src/ocorrencias/fotos.js';

type Consulta = { sql: string; params: unknown };

let consultas: Consulta[];
let resposta: (sql: string) => unknown[];
const banco = {
  query: vi.fn(async (sql: string, params?: unknown) => {
    const texto = sql.replace(/\s+/g, ' ').trim();
    consultas.push({ sql: texto, params });
    const rows = resposta(texto);
    return { rows, rowCount: rows.length };
  }),
  connect: vi.fn(),
};

beforeEach(() => {
  consultas = [];
  resposta = () => [];
});

const app = () =>
  criarApp({ origensCors: ['http://localhost:5173'], ambiente: 'test', sessaoHoras: 8, fotos: criarArmazenamentoDisco('nao-usada') }, banco as never);

const VEICULO = { codigo: '#04', descricao: 'Caminhão #04 - Boa Viagem', tipo_coleta: 'domiciliar', bairro: 'Boa Viagem', demonstrativo: true };
const PONTOS = [
  { ordem: 1, latitude: -8.121, longitude: -34.901 },
  { ordem: 2, latitude: -8.1215, longitude: -34.9005 },
];
const ROTA = {
  id: 3,
  nome: 'Rota demonstrativa #04 - Boa Viagem',
  demonstrativo: true,
  veiculo_codigo: '#04',
  veiculo_descricao: VEICULO.descricao,
  veiculo_tipo_coleta: 'domiciliar',
  veiculo_bairro: 'Boa Viagem',
  veiculo_demonstrativo: true,
  pontos: PONTOS,
};

describe('GET /api/veiculos', () => {
  it('é público e devolve só os campos do veículo, com demonstrativo', async () => {
    resposta = () => [VEICULO, { ...VEICULO, codigo: '#20', bairro: null, descricao: null }];
    const r = await request(app()).get('/api/veiculos');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      itens: [
        { codigo: '#04', descricao: 'Caminhão #04 - Boa Viagem', tipoColeta: 'domiciliar', bairro: 'Boa Viagem', demonstrativo: true },
        { codigo: '#20', descricao: null, tipoColeta: 'domiciliar', bairro: null, demonstrativo: true },
      ],
    });
    expect(banco.connect).not.toHaveBeenCalled();
  });

  it('filtra os ativos no próprio SQL, sem valores vindos da requisição', async () => {
    await request(app()).get("/api/veiculos?ativo=false&codigo=' OR 1=1--");
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.sql).toContain('WHERE v.ativo ORDER BY v.codigo');
    expect(consultas[0]!.params).toBeUndefined();
    expect(consultas[0]!.sql).not.toMatch(/OR 1=1|false/);
    // Nenhuma coluna interna é selecionada.
    expect(consultas[0]!.sql).not.toMatch(/v\.id\b|bairro_id AS|v\.ativo AS/);
  });
});

describe('GET /api/rotas', () => {
  it('é pública e devolve a rota, o veículo e os pontos em ordem', async () => {
    resposta = () => [ROTA];
    const r = await request(app()).get('/api/rotas');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      itens: [
        {
          id: 3,
          nome: 'Rota demonstrativa #04 - Boa Viagem',
          demonstrativo: true,
          veiculo: { codigo: '#04', descricao: VEICULO.descricao, tipoColeta: 'domiciliar', bairro: 'Boa Viagem', demonstrativo: true },
          pontos: PONTOS,
        },
      ],
    });
  });

  it('rota sem veículo ativo sai com veiculo null; rota sem pontos, com lista vazia', async () => {
    resposta = () => [
      { ...ROTA, veiculo_codigo: null, veiculo_descricao: null, veiculo_tipo_coleta: null, veiculo_bairro: null, veiculo_demonstrativo: null, pontos: [] },
    ];
    const r = await request(app()).get('/api/rotas');
    expect(r.body.itens[0]).toEqual({ id: 3, nome: ROTA.nome, demonstrativo: true, veiculo: null, pontos: [] });
  });

  it('o SQL só traz rotas ativas, veículo só se ativo e pontos por ordem, sem parâmetros da requisição', async () => {
    await request(app()).get('/api/rotas?ativa=false');
    expect(consultas).toHaveLength(1);
    const { sql, params } = consultas[0]!;
    expect(sql).toContain('WHERE r.ativa');
    expect(sql).toContain('LEFT JOIN veiculos v ON v.id = r.veiculo_id AND v.ativo');
    expect(sql).toContain('ORDER BY rp.ordem');
    expect(sql).toMatch(/ORDER BY r\.nome, r\.id$/);
    expect(params).toBeUndefined();
  });
});

describe('limites', () => {
  it.each([
    ['post', '/api/veiculos'],
    ['patch', '/api/veiculos/1'],
    ['delete', '/api/veiculos/1'],
    ['post', '/api/rotas'],
    ['put', '/api/rotas/1'],
    ['delete', '/api/rotas/1'],
    ['get', '/api/rotas/1'],
    ['get', '/api/veiculos/%2304'],
  ])('%s %s não existe (404), sem consultar o banco', async (metodo, rota) => {
    const r = await (request(app()) as unknown as Record<string, (r: string) => request.Test>)[metodo]!(rota).send({});
    expect(r.status).toBe(404);
    expect(consultas).toHaveLength(0);
  });

  it('escrita vinda de outro site é barrada antes de qualquer rota (CSRF)', async () => {
    const r = await request(app()).post('/api/rotas').set('Origin', 'https://outro.example').send({});
    expect(r.status).toBe(403);
  });

  it('falha do banco vira 500 genérico, sem detalhes', async () => {
    resposta = () => {
      throw new Error('detalhe interno do banco');
    };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const rota of ['/api/veiculos', '/api/rotas']) {
      const r = await request(app()).get(rota);
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ erro: 'Erro interno do servidor' });
    }
    erro.mockRestore();
  });
});
