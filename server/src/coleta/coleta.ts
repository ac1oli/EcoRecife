// Coleta (dados públicos e DEMONSTRATIVOS): veículos e rotas ativos. Tabelas veiculos,
// rotas e rota_pontos (migração 002); rotas do seed 002 (OpenStreetMap via OSRM).
// Não há integração com a frota: cada item sai com "demonstrativo" para o front rotular.
import type { Banco } from '../db.js';

type LinhaVeiculo = {
  codigo: string;
  descricao: string | null;
  tipo_coleta: string;
  bairro: string | null;
  demonstrativo: boolean;
};

// Só os campos públicos do veículo: o id interno e "ativo" ficam de fora.
function veiculo(linha: LinhaVeiculo) {
  return {
    codigo: linha.codigo,
    descricao: linha.descricao,
    tipoColeta: linha.tipo_coleta,
    bairro: linha.bairro,
    demonstrativo: linha.demonstrativo,
  };
}

export async function listarVeiculos(banco: Pick<Banco, 'query'>) {
  const { rows } = await banco.query<LinhaVeiculo>(
    `SELECT v.codigo, v.descricao, v.tipo_coleta, b.nome AS bairro, v.demonstrativo
       FROM veiculos v LEFT JOIN bairros b ON b.id = v.bairro_id
      WHERE v.ativo
      ORDER BY v.codigo`,
  );
  return { itens: rows.map(veiculo) };
}

type LinhaRota = {
  id: number;
  nome: string;
  demonstrativo: boolean;
  veiculo_codigo: string | null;
  veiculo_descricao: string | null;
  veiculo_tipo_coleta: string | null;
  veiculo_bairro: string | null;
  veiculo_demonstrativo: boolean | null;
  pontos: { ordem: number; latitude: number; longitude: number }[];
};

// Rotas ativas com o trajeto em ordem. O veículo só aparece se estiver ativo: uma rota
// sem veículo, ou com veículo inativo, sai com "veiculo": null.
export async function listarRotas(banco: Pick<Banco, 'query'>) {
  const { rows } = await banco.query<LinhaRota>(
    `SELECT r.id, r.nome, r.demonstrativo,
            v.codigo AS veiculo_codigo, v.descricao AS veiculo_descricao, v.tipo_coleta AS veiculo_tipo_coleta,
            b.nome AS veiculo_bairro, v.demonstrativo AS veiculo_demonstrativo,
            COALESCE((SELECT json_agg(json_build_object('ordem', rp.ordem,
                                                        'latitude', rp.latitude::float8,
                                                        'longitude', rp.longitude::float8) ORDER BY rp.ordem)
                        FROM rota_pontos rp WHERE rp.rota_id = r.id), '[]'::json) AS pontos
       FROM rotas r
       LEFT JOIN veiculos v ON v.id = r.veiculo_id AND v.ativo
       LEFT JOIN bairros b ON b.id = v.bairro_id
      WHERE r.ativa
      ORDER BY r.nome, r.id`,
  );
  return {
    itens: rows.map((linha) => ({
      id: linha.id,
      nome: linha.nome,
      demonstrativo: linha.demonstrativo,
      veiculo:
        linha.veiculo_codigo === null
          ? null
          : veiculo({
              codigo: linha.veiculo_codigo,
              descricao: linha.veiculo_descricao,
              tipo_coleta: linha.veiculo_tipo_coleta!,
              bairro: linha.veiculo_bairro,
              demonstrativo: linha.veiculo_demonstrativo!,
            }),
      pontos: linha.pontos,
    })),
  };
}
