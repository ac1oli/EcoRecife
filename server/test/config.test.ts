import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analisarUrlSupabase, carregarConfig, carregarConfigStorage, ErroConfiguracao } from '../src/config.js';

// Valores fictícios: nenhum projeto, senha ou chave real aparece nos testes.
const REF = 'abcdefghijklmnopqrst';
const POOLER = `postgresql://postgres.${REF}:senha-ficticia@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
const DIRETA = `postgresql://postgres:senha-ficticia@db.${REF}.supabase.co:5432/postgres`;
const PASTA = mkdtempSync(path.join(tmpdir(), 'ecorecife-config-'));
const CA = path.join(PASTA, 'ca.crt');
writeFileSync(CA, '-----BEGIN CERTIFICATE-----\nMIIfalso\n-----END CERTIFICATE-----\n');
const NAO_PEM = path.join(PASTA, 'texto.txt');
writeFileSync(NAO_PEM, 'não é um certificado');
const BASE = { DATABASE_URL: POOLER, DATABASE_SSL_CA: CA };

describe('carregarConfig', () => {
  it('aplica os padrões com a URL do pooler de sessão e o certificado', () => {
    expect(carregarConfig(BASE)).toEqual({
      ambiente: 'development',
      porta: 3333,
      databaseUrl: POOLER,
      bancoCertificadoCa: '-----BEGIN CERTIFICATE-----\nMIIfalso\n-----END CERTIFICATE-----\n',
      projetoSupabase: REF,
      origensCors: ['http://localhost:5173'],
      sessaoHoras: 8,
      simulacaoAtiva: true,
      simulacaoIntervaloMs: 3000,
    });
  });

  it('aceita a conexão direta (db.<ref>.supabase.co) e identifica o projeto', () => {
    expect(carregarConfig({ ...BASE, DATABASE_URL: DIRETA }).projetoSupabase).toBe(REF);
  });

  it('tira da URL os parâmetros de TLS (a verificação vem só do certificado)', () => {
    const config = carregarConfig({ ...BASE, DATABASE_URL: `${POOLER}?sslmode=require&sslrootcert=x.crt&application_name=eco` });
    expect(config.databaseUrl).toBe(`${POOLER}?application_name=eco`);
  });

  it('lê o certificado relativo à pasta server/ por padrão (certs/prod-ca-2021.crt)', () => {
    const padrao = path.resolve(import.meta.dirname, '../certs/prod-ca-2021.crt');
    if (existsSync(padrao)) {
      expect(carregarConfig({ DATABASE_URL: POOLER }).bancoCertificadoCa).toBe(readFileSync(padrao, 'utf8'));
    } else {
      expect(() => carregarConfig({ DATABASE_URL: POOLER })).toThrow(/prod-ca-2021\.crt/);
    }
  });

  it('lê SIMULACAO_ATIVA e SIMULACAO_INTERVALO_MS', () => {
    const config = carregarConfig({ ...BASE, SIMULACAO_ATIVA: 'false', SIMULACAO_INTERVALO_MS: '5000' });
    expect(config).toMatchObject({ simulacaoAtiva: false, simulacaoIntervaloMs: 5000 });
    expect(carregarConfig({ ...BASE, SIMULACAO_ATIVA: 'true' }).simulacaoAtiva).toBe(true);
  });

  it('lê porta, ambiente e várias origens de CORS (sem barra final)', () => {
    const config = carregarConfig({
      ...BASE,
      NODE_ENV: 'production',
      PORTA: '8080',
      CORS_ORIGENS: 'https://eco.exemplo.org/, http://localhost:5173',
    });
    expect(config.porta).toBe(8080);
    expect(config.ambiente).toBe('production');
    expect(config.origensCors).toEqual(['https://eco.exemplo.org', 'http://localhost:5173']);
  });

  it('lê SESSAO_HORAS', () => {
    expect(carregarConfig({ ...BASE, SESSAO_HORAS: '24' }).sessaoHoras).toBe(24);
  });

  it('recusa a ausência de DATABASE_URL', () => {
    expect(() => carregarConfig({})).toThrow(ErroConfiguracao);
    expect(() => carregarConfig({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['DATABASE_URL não postgres', { ...BASE, DATABASE_URL: 'mysql://x@localhost/db' }],
    ['banco local (o oficial é o Supabase)', { ...BASE, DATABASE_URL: 'postgres://usuario:senha@localhost:5432/ecorecife' }],
    ['outro host qualquer', { ...BASE, DATABASE_URL: 'postgres://u:s@banco.exemplo.org:5432/ecorecife' }],
    ['host parecido com o do Supabase', { ...BASE, DATABASE_URL: `postgres://postgres:s@db.${REF}.supabase.co.exemplo.org:5432/postgres` }],
    ['pooler de transação (porta 6543)', { ...BASE, DATABASE_URL: POOLER.replace(':5432/', ':6543/') }],
    ['porta inesperada', { ...BASE, DATABASE_URL: POOLER.replace(':5432/', ':5433/') }],
    ['pooler sem postgres.<ref> no usuário', { ...BASE, DATABASE_URL: POOLER.replace(`postgres.${REF}`, 'postgres') }],
    ['URL sem senha', { ...BASE, DATABASE_URL: POOLER.replace(':senha-ficticia', '') }],
    ['certificado ausente', { ...BASE, DATABASE_SSL_CA: path.join(PASTA, 'nao-existe.crt') }],
    ['certificado que não é PEM', { ...BASE, DATABASE_SSL_CA: NAO_PEM }],
    ['porta não numérica', { ...BASE, PORTA: 'abc' }],
    ['porta fora do intervalo', { ...BASE, PORTA: '70000' }],
    ['ambiente desconhecido', { ...BASE, NODE_ENV: 'staging' }],
    ['origem CORS inválida', { ...BASE, CORS_ORIGENS: 'localhost:5173' }],
    ['origem CORS curinga', { ...BASE, CORS_ORIGENS: '*' }],
    ['CORS vazio', { ...BASE, CORS_ORIGENS: ' , ' }],
    ['sessão de 0 horas', { ...BASE, SESSAO_HORAS: '0' }],
    ['sessão maior que 7 dias', { ...BASE, SESSAO_HORAS: '169' }],
    ['sessão fracionária', { ...BASE, SESSAO_HORAS: '1.5' }],
    ['SIMULACAO_ATIVA fora de true/false', { ...BASE, SIMULACAO_ATIVA: 'sim' }],
    ['SIMULACAO_ATIVA vazia', { ...BASE, SIMULACAO_ATIVA: '' }],
    ['intervalo menor que 1 s', { ...BASE, SIMULACAO_INTERVALO_MS: '999' }],
    ['intervalo maior que 60 s', { ...BASE, SIMULACAO_INTERVALO_MS: '60001' }],
    ['intervalo fracionário', { ...BASE, SIMULACAO_INTERVALO_MS: '1500.5' }],
  ])('recusa %s', (_caso, env) => {
    expect(() => carregarConfig(env)).toThrow(ErroConfiguracao);
  });

  it('não expõe a senha do banco nas mensagens de erro', () => {
    for (const env of [{ ...BASE, PORTA: 'abc' }, { ...BASE, DATABASE_URL: POOLER.replace(':5432/', ':6543/') }]) {
      expect(() => carregarConfig(env)).toThrow(ErroConfiguracao);
      try {
        carregarConfig(env);
      } catch (erro) {
        expect((erro as Error).message).not.toContain('senha-ficticia');
      }
    }
  });

  it('analisarUrlSupabase devolve o id do projeto', () => {
    expect(analisarUrlSupabase(POOLER).projeto).toBe(REF);
  });
});

describe('carregarConfigStorage', () => {
  const STORAGE = { SUPABASE_URL: `https://${REF}.supabase.co`, SUPABASE_SECRET_KEY: 'sb_secret_ficticia_0123456789' };

  it('lê a URL, a secret key e o bucket padrão', () => {
    expect(carregarConfigStorage(STORAGE, REF)).toEqual({
      supabaseUrl: `https://${REF}.supabase.co`,
      chaveSecreta: 'sb_secret_ficticia_0123456789',
      bucketFotos: 'ocorrencias-fotos',
      projeto: REF,
    });
  });

  it.each([
    ['sem URL', { SUPABASE_SECRET_KEY: STORAGE.SUPABASE_SECRET_KEY }],
    ['sem chave', { SUPABASE_URL: STORAGE.SUPABASE_URL }],
    ['publishable key no lugar da secret', { ...STORAGE, SUPABASE_SECRET_KEY: 'sb_publishable_ficticia_0123456789' }],
    ['chave em outro formato', { ...STORAGE, SUPABASE_SECRET_KEY: 'chave-qualquer' }],
    ['valor de exemplo do .env.example', { ...STORAGE, SUPABASE_SECRET_KEY: 'sb_secret_TROQUE_PELA_SUA' }],
    ['URL http', { ...STORAGE, SUPABASE_URL: `http://${REF}.supabase.co` }],
    ['URL de outro domínio', { ...STORAGE, SUPABASE_URL: 'https://exemplo.org' }],
    ['bucket com caracteres inválidos', { ...STORAGE, SUPABASE_BUCKET_FOTOS: 'Fotos/../x' }],
  ])('recusa %s', (_caso, env) => {
    expect(() => carregarConfigStorage(env, REF)).toThrow(ErroConfiguracao);
  });

  it('recusa Storage e banco de projetos diferentes', () => {
    expect(() => carregarConfigStorage(STORAGE, 'zzzzzzzzzzzzzzzzzzzz')).toThrow(/projetos diferentes/);
  });

  it('não expõe a chave na mensagem de erro', () => {
    try {
      carregarConfigStorage({ ...STORAGE, SUPABASE_URL: 'http://x' }, REF);
    } catch (erro) {
      expect((erro as Error).message).not.toContain('sb_secret_ficticia');
    }
  });
});
