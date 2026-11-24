# -*- coding: utf-8 -*-
"""Gera docs/Documentacao_Tecnica_EcoRecife.docx (python-docx).

Uso (na raiz do repositório, com python-docx instalado):
    python docs/documentacao-tecnica/gerar_documentacao.py

Os diagramas vêm de docs/documentacao-tecnica/diagramas/*.png, gerados a partir dos
arquivos .mmd (Mermaid) com o mermaid-cli. O sumário e as listas de figuras e tabelas
são campos do Word: atualize-os ao abrir (F9) ou pelo script de atualização via Word.
"""
import re
import struct
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

RAIZ = Path(__file__).resolve().parents[2]
DIAGRAMAS = Path(__file__).resolve().parent / 'diagramas'
SAIDA = RAIZ / 'docs' / 'Documentacao_Tecnica_EcoRecife.docx'

VERDE = RGBColor(0x14, 0x53, 0x2D)
VERDE_HEX = '1F6F43'
CINZA_TEXTO = RGBColor(0x40, 0x40, 0x40)
FONTE = 'Arial'
LARGURA_UTIL = 16.0  # cm (A4 com margens 3/2)
FONTE_FIGURA = 'Fonte: elaborado pela equipe a partir do código-fonte do repositório EcoRecife (2026).'
FONTE_TABELA = 'Fonte: elaborado pela equipe a partir do código-fonte do repositório EcoRecife (2026).'
PENDENTE = '[a preencher pela equipe]'

doc = Document()


# ---------------------------------------------------------------------------
# Estilos e página
# ---------------------------------------------------------------------------

def configurar_estilos():
    estilos = doc.styles
    normal = estilos['Normal']
    normal.font.name = FONTE
    normal.font.size = Pt(11)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), FONTE)
    pf = normal.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf.line_spacing = 1.3
    pf.space_after = Pt(6)
    pf.space_before = Pt(0)

    for nome, tamanho, antes, depois in (('Heading 1', 16, 0, 12), ('Heading 2', 13, 14, 6), ('Heading 3', 11.5, 10, 4)):
        st = estilos[nome]
        st.font.name = FONTE
        st.font.size = Pt(tamanho)
        st.font.bold = True
        st.font.italic = False
        st.font.color.rgb = VERDE
        rfonts = st.element.rPr.find(qn('w:rFonts'))
        for atributo in ('w:asciiTheme', 'w:hAnsiTheme', 'w:eastAsiaTheme', 'w:cstheme'):
            if rfonts is not None and rfonts.get(qn(atributo)) is not None:
                del rfonts.attrib[qn(atributo)]
        st.element.rPr.rFonts.set(qn('w:ascii'), FONTE)
        st.element.rPr.rFonts.set(qn('w:hAnsi'), FONTE)
        st.paragraph_format.space_before = Pt(antes)
        st.paragraph_format.space_after = Pt(depois)
        st.paragraph_format.keep_with_next = True
        st.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        st.paragraph_format.line_spacing = 1.15
    estilos['Heading 1'].paragraph_format.page_break_before = True

    legenda = estilos['Caption']
    legenda.font.name = FONTE
    legenda.font.size = Pt(9.5)
    legenda.font.bold = True
    legenda.font.italic = False
    legenda.font.color.rgb = CINZA_TEXTO
    legenda.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    legenda.paragraph_format.space_before = Pt(8)
    legenda.paragraph_format.space_after = Pt(4)
    legenda.paragraph_format.keep_with_next = True

    for nome in ('List Bullet', 'List Number', 'List Bullet 2'):
        st = estilos[nome]
        st.font.name = FONTE
        st.font.size = Pt(11)
        st.paragraph_format.space_after = Pt(3)
        st.paragraph_format.line_spacing = 1.25
        st.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    for nome in ('TOC 1', 'TOC 2', 'TOC 3', 'Table of Figures'):
        try:
            st = estilos[nome]
        except KeyError:
            st = estilos.add_style(nome, 1)
        st.font.name = FONTE
        st.font.size = Pt(10)
        st.paragraph_format.space_after = Pt(1)
        st.paragraph_format.line_spacing = 1.1
        st.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT


def configurar_pagina(secao):
    secao.page_width = Cm(21)
    secao.page_height = Cm(29.7)
    secao.top_margin = Cm(3)
    secao.left_margin = Cm(3)
    secao.bottom_margin = Cm(2)
    secao.right_margin = Cm(2)
    secao.header_distance = Cm(1.25)
    secao.footer_distance = Cm(1.0)


# ---------------------------------------------------------------------------
# Campos, parágrafos e formatação em linha
# ---------------------------------------------------------------------------

def campo(paragrafo, instrucao, texto_provisorio=''):
    def fld(tipo):
        el = OxmlElement('w:fldChar')
        el.set(qn('w:fldCharType'), tipo)
        if tipo == 'begin':
            el.set(qn('w:dirty'), 'true')
        return el

    r1 = paragrafo.add_run()
    r1._r.append(fld('begin'))
    r2 = paragrafo.add_run()
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = f' {instrucao} '
    r2._r.append(instr)
    r3 = paragrafo.add_run()
    r3._r.append(fld('separate'))
    r4 = paragrafo.add_run(texto_provisorio)
    r5 = paragrafo.add_run()
    r5._r.append(fld('end'))
    return r4


PADRAO_EM_LINHA = re.compile(r'(\*\*.+?\*\*|`.+?`)')


def texto_formatado(paragrafo, texto, tamanho=None):
    for parte in PADRAO_EM_LINHA.split(texto):
        if not parte:
            continue
        if parte.startswith('**') and parte.endswith('**'):
            run = paragrafo.add_run(parte[2:-2])
            run.bold = True
        elif parte.startswith('`') and parte.endswith('`'):
            run = paragrafo.add_run(parte[1:-1])
            run.font.name = 'Consolas'
            run._r.get_or_add_rPr().get_or_add_rFonts().set(qn('w:hAnsi'), 'Consolas')
            run.font.size = Pt((tamanho or 11) - 1)
            run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x2B)
        else:
            run = paragrafo.add_run(parte)
        if tamanho and not (parte.startswith('`') and parte.endswith('`')):
            run.font.size = Pt(tamanho)
    return paragrafo


def p(texto, estilo=None, alinhamento=None):
    paragrafo = doc.add_paragraph(style=estilo)
    texto_formatado(paragrafo, texto)
    if alinhamento is not None:
        paragrafo.alignment = alinhamento
    return paragrafo


def topicos(itens, estilo='List Bullet'):
    for item in itens:
        p(item, estilo)


def h1(texto):
    return doc.add_heading(texto, level=1)


def h2(texto):
    return doc.add_heading(texto, level=2)


def h3(texto):
    return doc.add_heading(texto, level=3)


def sombrear(elemento_pr, cor):
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), cor)
    elemento_pr.append(shd)


def codigo(linhas):
    for i, linha in enumerate(linhas):
        paragrafo = doc.add_paragraph()
        paragrafo.alignment = WD_ALIGN_PARAGRAPH.LEFT
        pf = paragrafo.paragraph_format
        pf.space_after = Pt(0) if i < len(linhas) - 1 else Pt(8)
        pf.space_before = Pt(6) if i == 0 else Pt(0)
        pf.line_spacing = 1.0
        pf.left_indent = Cm(0.3)
        pf.keep_with_next = i < len(linhas) - 1
        sombrear(paragrafo._p.get_or_add_pPr(), 'F1F5F2')
        run = paragrafo.add_run(linha if linha else ' ')
        run.font.name = 'Consolas'
        run._r.get_or_add_rPr().get_or_add_rFonts().set(qn('w:hAnsi'), 'Consolas')
        run.font.size = Pt(9)


contador = {'Figura': 0, 'Tabela': 0}


def legenda(tipo, titulo):
    contador[tipo] += 1
    paragrafo = doc.add_paragraph(style='Caption')
    paragrafo.add_run(f'{tipo} ')
    campo(paragrafo, f'SEQ {tipo} \\* ARABIC', str(contador[tipo]))
    paragrafo.add_run(f' – {titulo}')
    return paragrafo


def nota_fonte(texto):
    paragrafo = doc.add_paragraph()
    paragrafo.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragrafo.paragraph_format.space_after = Pt(10)
    run = paragrafo.add_run(texto)
    run.font.size = Pt(8.5)
    run.font.color.rgb = CINZA_TEXTO
    return paragrafo


def tamanho_png(caminho):
    with open(caminho, 'rb') as arquivo:
        cabecalho = arquivo.read(24)
    return struct.unpack('>II', cabecalho[16:24])


def figura(arquivo, titulo, largura_max=LARGURA_UTIL, altura_max=20.5):
    caminho = DIAGRAMAS / arquivo
    largura_px, altura_px = tamanho_png(caminho)
    largura = min(largura_max, altura_max * largura_px / altura_px)
    legenda('Figura', titulo)
    paragrafo = doc.add_paragraph()
    paragrafo.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragrafo.paragraph_format.keep_with_next = True
    paragrafo.paragraph_format.space_after = Pt(2)
    paragrafo.add_run().add_picture(str(caminho), width=Cm(largura))
    nota_fonte(FONTE_FIGURA + f' Fonte editável: docs/documentacao-tecnica/diagramas/{arquivo.replace(".png", ".mmd")}.')


def tabela(titulo, cabecalho, linhas, larguras, tamanho=9, fonte=FONTE_TABELA):
    assert abs(sum(larguras) - LARGURA_UTIL) < 0.05, (titulo, sum(larguras))
    legenda('Tabela', titulo)
    t = doc.add_table(rows=1, cols=len(cabecalho))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    tbl_pr = t._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tbl_pr.append(layout)

    def preencher(celula, texto, negrito=False, cor=None):
        celula.paragraphs[0].text = ''
        partes = texto.split('\n')
        for i, parte in enumerate(partes):
            paragrafo = celula.paragraphs[0] if i == 0 else celula.add_paragraph()
            paragrafo.alignment = WD_ALIGN_PARAGRAPH.LEFT
            paragrafo.paragraph_format.space_after = Pt(1)
            paragrafo.paragraph_format.line_spacing = 1.1
            texto_formatado(paragrafo, parte, tamanho)
            for run in paragrafo.runs:
                if negrito:
                    run.bold = True
                if cor:
                    run.font.color.rgb = cor
        celula.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

    for i, texto in enumerate(cabecalho):
        celula = t.rows[0].cells[i]
        preencher(celula, texto, negrito=True, cor=RGBColor(0xFF, 0xFF, 0xFF))
        sombrear(celula._tc.get_or_add_tcPr(), VERDE_HEX)
    tr_pr = t.rows[0]._tr.get_or_add_trPr()
    cabecalho_repete = OxmlElement('w:tblHeader')
    cabecalho_repete.set(qn('w:val'), 'true')
    tr_pr.append(cabecalho_repete)

    for n, linha in enumerate(linhas):
        celulas = t.add_row().cells
        for i, texto in enumerate(linha):
            preencher(celulas[i], texto)
            if n % 2 == 1:
                sombrear(celulas[i]._tc.get_or_add_tcPr(), 'F3F7F4')
    for linha in t.rows:
        nao_divide = OxmlElement('w:cantSplit')
        nao_divide.set(qn('w:val'), 'true')
        linha._tr.get_or_add_trPr().append(nao_divide)
        for i, largura in enumerate(larguras):
            linha.cells[i].width = Cm(largura)
    for i, largura in enumerate(larguras):
        t.columns[i].width = Cm(largura)
    # Tabelas curtas ficam inteiras na mesma página (as longas repetem o cabeçalho).
    # A última linha sempre acompanha a nota de fonte logo abaixo.
    if len(linhas) <= 14:
        for linha in t.rows:
            for celula in linha.cells:
                for paragrafo in celula.paragraphs:
                    paragrafo.paragraph_format.keep_with_next = True
    else:
        for celula in t.rows[-1].cells:
            for paragrafo in celula.paragraphs:
                paragrafo.paragraph_format.keep_with_next = True
    nota_fonte(fonte)
    return t


# ---------------------------------------------------------------------------
# Capa, cabeçalho, rodapé, sumário
# ---------------------------------------------------------------------------

def linha_capa(texto, tamanho, negrito=False, antes=0, depois=0, cor=None, italico=False):
    paragrafo = doc.add_paragraph()
    paragrafo.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragrafo.paragraph_format.space_before = Pt(antes)
    paragrafo.paragraph_format.space_after = Pt(depois)
    paragrafo.paragraph_format.line_spacing = 1.15
    run = paragrafo.add_run(texto)
    run.font.size = Pt(tamanho)
    run.bold = negrito
    run.italic = italico
    if cor:
        run.font.color.rgb = cor
    return paragrafo


def capa():
    linha_capa('CENTRO UNIVERSITÁRIO MAURÍCIO DE NASSAU – UNINASSAU', 13, True)
    linha_capa(f'Campus: {PENDENTE}', 11, depois=2)
    linha_capa('Curso: ' + PENDENTE, 11, depois=2)
    linha_capa('Disciplina: Desenvolvimento de Aplicações para Internet', 11, depois=2)
    linha_capa('Turma 2NA – Noite · Semestre 2026.2', 11, depois=2)
    linha_capa(f'Professor(a): {PENDENTE}', 11)

    linha_capa('EcoRecife', 34, True, antes=110, cor=VERDE)
    linha_capa('Plataforma de gestão digital de resíduos sólidos urbanos do Recife', 14, antes=6, depois=4)
    linha_capa('Documentação Técnica e Arquitetura da Solução', 13, True, antes=10)
    linha_capa('Projeto Prático AV2 – Banco de Oportunidades da Prefeitura do Recife (Edital nº 02/2026.2)', 10.5, antes=6,
               cor=CINZA_TEXTO, italico=True)

    linha_capa('Integrantes da equipe', 11.5, True, antes=80, depois=4)
    for nome in ('Alexsandro Acioli Pimentel Filho', 'Gabriel Silvestre Gomes', 'João Batista de Oliveira',
                 'João Vitor da Silva Vieira', 'Talles Eduardo Barbosa de Oliveira e Silva'):
        linha_capa(nome, 11, depois=1)

    linha_capa('Recife – PE', 11.5, True, antes=70, depois=2)
    linha_capa('2026', 11.5, True)


def cabecalho_rodape(secao):
    secao.different_first_page_header_footer = True
    cab = secao.header.paragraphs[0]
    cab.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = cab.add_run('EcoRecife · Documentação Técnica · UNINASSAU 2026.2')
    run.font.size = Pt(8.5)
    run.font.color.rgb = CINZA_TEXTO
    borda = OxmlElement('w:pBdr')
    inferior = OxmlElement('w:bottom')
    inferior.set(qn('w:val'), 'single')
    inferior.set(qn('w:sz'), '4')
    inferior.set(qn('w:space'), '4')
    inferior.set(qn('w:color'), VERDE_HEX)
    borda.append(inferior)
    cab._p.get_or_add_pPr().append(borda)

    rod = secao.footer.paragraphs[0]
    rod.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for parte in ('Página ',):
        r = rod.add_run(parte)
        r.font.size = Pt(9)
    campo(rod, 'PAGE', '1').font.size = Pt(9)
    r = rod.add_run(' de ')
    r.font.size = Pt(9)
    campo(rod, 'NUMPAGES', '1').font.size = Pt(9)


def titulo_sem_numero(texto):
    paragrafo = doc.add_paragraph()
    paragrafo.paragraph_format.page_break_before = True
    paragrafo.paragraph_format.space_after = Pt(12)
    run = paragrafo.add_run(texto)
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = VERDE
    return paragrafo


def paragrafo_de_campo():
    # O Word deixa o parágrafo original vazio depois da lista gerada; com altura mínima,
    # ele não empurra o capítulo seguinte para uma página em branco.
    paragrafo = doc.add_paragraph()
    pf = paragrafo.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    pf.line_spacing = Pt(1)
    rpr = OxmlElement('w:rPr')
    tamanho = OxmlElement('w:sz')
    tamanho.set(qn('w:val'), '2')
    rpr.append(tamanho)
    paragrafo._p.get_or_add_pPr().append(rpr)
    return paragrafo


def sumario_e_listas():
    titulo_sem_numero('Sumário')
    campo(paragrafo_de_campo(), 'TOC \\o "1-2" \\h \\z \\u', 'Clique com o botão direito e escolha "Atualizar campo" para gerar o sumário.')
    titulo_sem_numero('Lista de figuras')
    campo(paragrafo_de_campo(), 'TOC \\h \\z \\c "Figura"', 'Atualize o campo para gerar a lista de figuras.')
    paragrafo = doc.add_paragraph()
    paragrafo.paragraph_format.space_before = Pt(18)
    run = paragrafo.add_run('Lista de tabelas')
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = VERDE
    paragrafo.paragraph_format.keep_with_next = True
    campo(paragrafo_de_campo(), 'TOC \\h \\z \\c "Tabela"', 'Atualize o campo para gerar a lista de tabelas.')


# ---------------------------------------------------------------------------
# Conteúdo
# ---------------------------------------------------------------------------

def capitulo_1():
    h1('1. Apresentação do projeto')
    h2('1.1 Identificação')
    tabela('Identificação do projeto', ['Item', 'Descrição'], [
        ['Projeto', 'EcoRecife – plataforma de gestão digital de resíduos sólidos urbanos do Recife'],
        ['Instituição', 'Centro Universitário Maurício de Nassau (UNINASSAU)'],
        ['Campus', PENDENTE],
        ['Curso', PENDENTE],
        ['Disciplina', 'Desenvolvimento de Aplicações para Internet'],
        ['Turma e semestre', '2NA – Noite · 2026.2'],
        ['Professor(a) responsável', PENDENTE],
        ['Avaliação', 'Projeto Prático AV2 – implementação (Edital nº 02/2026.2)'],
        ['Desafio atendido', 'Banco de Oportunidades da Prefeitura do Recife – gestão de resíduos sólidos urbanos'],
        ['Repositório', 'https://github.com/ac1oli/EcoRecife'],
        ['Equipe', 'Alexsandro Acioli Pimentel Filho · Gabriel Silvestre Gomes · João Batista de Oliveira · '
                   'João Vitor da Silva Vieira · Talles Eduardo Barbosa de Oliveira e Silva'],
    ], [4.2, 11.8])
    p('Os papéis técnicos de cada integrante não estão registrados no repositório e devem ser informados pela equipe:')
    tabela('Papéis técnicos da equipe', ['Integrante', 'Papel técnico'], [
        ['Alexsandro Acioli Pimentel Filho', PENDENTE],
        ['Gabriel Silvestre Gomes', PENDENTE],
        ['João Batista de Oliveira', PENDENTE],
        ['João Vitor da Silva Vieira', PENDENTE],
        ['Talles Eduardo Barbosa de Oliveira e Silva', PENDENTE],
    ], [8.0, 8.0])

    h2('1.2 Contextualização')
    p('O EcoRecife é um projeto acadêmico desenvolvido para o Banco de Oportunidades da Prefeitura do Recife, no '
      'Projeto Prático AV2 da UNINASSAU. A AV2 transforma o protótipo validado na AV1 (Figma) em uma aplicação '
      'real, com código-fonte estruturado, banco de dados e integrações. O tema escolhido é a gestão de resíduos '
      'sólidos urbanos, com foco em aproximar o cidadão da coleta, dos pontos de descarte e da zeladoria urbana.')
    h2('1.3 Problema')
    p('O cidadão tem pouca visibilidade sobre a coleta de resíduos do seu bairro, não sabe facilmente onde '
      'descartar materiais especiais (eletroeletrônicos, óleo, entulho, volumosos) e não dispõe de um canal simples '
      'para relatar problemas como descarte irregular, lixeiras danificadas ou acúmulo de entulho, nem de um meio '
      'para acompanhar a resposta do poder público.')
    h2('1.4 Justificativa')
    p('Informação acessível e participação cidadã reduzem o descarte irregular e ajudam a gestão a priorizar o '
      'atendimento. Um canal com protocolo dá transparência ao cidadão, que acompanha o andamento sem se '
      'identificar, e à gestão, que passa a ter fila, histórico e prioridades registrados em banco de dados.')
    h2('1.5 Objetivo geral')
    p('Desenvolver uma aplicação web que integre o acompanhamento (demonstrativo) da coleta, o registro e a '
      'gestão de ocorrências com protocolo (Zeladoria Cidadã) e um guia de reciclagem com os pontos de descarte do '
      'Recife, apoiada por uma API segura e por um banco de dados relacional gerenciado.')
    h2('1.6 Objetivos específicos')
    topicos([
        'Permitir que o cidadão registre ocorrências de forma anônima, com até três fotos, e receba um protocolo.',
        'Permitir a consulta pública do andamento pelo protocolo, expondo apenas dados não sensíveis.',
        'Oferecer à gestão (perfis `admin` e `gestor`) listagem, filtros, mudança de status, prioridade, conclusão, '
        'reabertura e histórico auditável das ocorrências.',
        'Disponibilizar um guia de reciclagem com EcoPontos, PEVs e cooperativas, materiais aceitos e os pontos mais '
        'próximos de uma posição.',
        'Exibir rotas de coleta e a posição simulada dos caminhões em tempo real, sempre identificadas como '
        'demonstrativas.',
        'Garantir segurança no back-end: autenticação própria, autorização por perfil, validação de entradas, '
        'limite de tentativas e proteção dos dados no Supabase.',
    ])
    h2('1.7 Público-alvo')
    topicos([
        '**Cidadãos do Recife:** consultam a coleta e os pontos de descarte e relatam problemas.',
        '**Gestores e administradores municipais:** acompanham, priorizam e resolvem as ocorrências e mantêm o '
        'cadastro dos pontos de descarte.',
    ])
    h2('1.8 Proposta da solução')
    p('A solução é composta por um front-end web responsivo (React), por uma API REST (Node.js e Express) com '
      'comunicação em tempo real (Socket.IO) e pelo banco de dados PostgreSQL gerenciado pelo Supabase, com as '
      'fotografias no Supabase Storage. O front-end conversa apenas com a API; a API concentra as regras de '
      'negócio, a autenticação e o acesso ao banco.')
    h2('1.9 Escopo')
    p('Fazem parte do escopo os três módulos – coleta (simulada), Zeladoria Cidadã e guia de reciclagem – e a área '
      'de gestão. **Não fazem parte do escopo:** integração com a frota real ou com sistemas da Prefeitura, rastreamento '
      'real de veículos e dados oficiais não verificados. Toda posição de caminhão, rota, ponto de descarte e ocorrência '
      'de exemplo é **demonstrativa** e marcada no banco com `demonstrativo = true`.')


def capitulo_2():
    h1('2. Visão geral das funcionalidades')
    p('A tabela a seguir separa o que existe no back-end (API e banco), o que já aparece no front-end e o que ainda '
      'não está implementado. O front-end atual é o protótipo convertido do Figma: ele funciona sozinho, com dados '
      'guardados no navegador (`localStorage` e IndexedDB), e **ainda não consome a API** – essa integração é a meta '
      'do Checkpoint 3 (27/11/2026).')
    sim, nao, prot = 'Sim (testado)', 'Não', 'Protótipo local, sem API'
    tabela('Funcionalidades por camada', ['Funcionalidade', 'Back-end (API + banco)', 'Front-end'], [
        ['Registro de ocorrência pelo cidadão', sim, prot],
        ['Upload de até 3 fotos (validadas pelo conteúdo)', sim + '; arquivos no Supabase Storage', 'Protótipo local (IndexedDB)'],
        ['Geração de protocolo `ECO-AAAA-XXXX-XXXX`', sim + ' (função `gerar_protocolo`)', 'Protótipo gera um número aleatório local'],
        ['Consulta pública por protocolo', sim + ' (com limite de tentativas)', nao],
        ['Painel de gestão: fila, filtros, detalhe', sim + ' (paginação e busca)', prot],
        ['Atualização de status, conclusão e reabertura', sim + ' (transições validadas)', prot],
        ['Prioridade da ocorrência', sim, prot],
        ['Histórico de alterações (auditoria)', sim + ' (usuário da sessão)', nao],
        ['Consulta protegida de fotografias', sim + ' (sessão + perfil)', prot],
        ['Login, logout e sessão', sim + ' (bcrypt + cookie httpOnly)', 'Tela de login sem autenticação real'],
        ['Controle de acesso por perfil', sim + ' (`admin`, `gestor`)', nao],
        ['Guia de reciclagem (lista e filtros)', sim + ' (tipo e material)', 'Lista local no protótipo'],
        ['Materiais aceitos por ponto', sim + ' (nos dados de cada ponto)', 'Exibição local'],
        ['Pontos mais próximos de uma posição', sim + ' (Haversine)', nao],
        ['Cadastro, edição e desativação de pontos', sim + ' (só `admin`)', nao],
        ['Veículos e rotas de coleta', sim + ' (7 veículos, 7 rotas)', 'Marcadores fixos no mapa'],
        ['Simulação dos caminhões em tempo real', sim + ' (Socket.IO)', nao],
        ['Mapa interativo (Leaflet + OpenStreetMap)', '—', 'Sim (dados locais)'],
        ['Página de benefícios com simulador educativo', '—', 'Sim (cálculo local)'],
        ['Saúde da API (`/api/saude`)', sim, '—'],
    ], [6.2, 5.2, 4.6])
    p('**Leitura da tabela:** "Sim (testado)" significa implementado no back-end e coberto por testes automatizados '
      '(capítulo 11); não significa que a tela correspondente já use a API. A integração do front-end com a API, a '
      'tela pública de consulta por protocolo e o mapa com a simulação em tempo real estão planejados para o '
      'Checkpoint 3.')


def capitulo_3():
    h1('3. Requisitos funcionais e não funcionais')
    p('Os requisitos abaixo foram levantados a partir do código-fonte, das migrações e da documentação do '
      'repositório (`docs/02`, `docs/04` e `docs/06`). Nenhum requisito foi criado sem correspondência no projeto.')
    h2('3.1 Requisitos funcionais')
    api = 'Implementado e testado na API; front no CP3'
    tabela('Requisitos funcionais', ['ID', 'Descrição', 'Finalidade', 'Situação'], [
        ['RF01', 'Registrar ocorrência anônima com categoria, bairro, endereço, descrição e localização opcional', 'Canal de zeladoria sem exigir cadastro', api],
        ['RF02', 'Anexar até 3 fotos (jpeg, png ou webp, até 5 MB cada)', 'Evidenciar o problema', api],
        ['RF03', 'Gerar protocolo único e não sequencial `ECO-AAAA-XXXX-XXXX`', 'Acompanhamento sem identificar o cidadão', 'Implementado e testado (banco e API)'],
        ['RF04', 'Consultar ocorrência pelo protocolo, com linha do tempo de status', 'Transparência ao cidadão', api],
        ['RF05', 'Listar ocorrências para a gestão com filtros (fila, status, prioridade, categoria, bairro, busca) e paginação', 'Organizar o atendimento', api],
        ['RF06', 'Detalhar uma ocorrência, com fotos e histórico', 'Apoiar a decisão da gestão', api],
        ['RF07', 'Alterar o status entre estados ativos, com transições validadas', 'Fluxo de atendimento', api],
        ['RF08', 'Concluir (com nota opcional) e reabrir ocorrências', 'Encerramento e correção', api],
        ['RF09', 'Alterar a prioridade (urgente, alta, média, baixa)', 'Priorizar o atendimento', api],
        ['RF10', 'Registrar o histórico de cada mudança de status com o usuário responsável', 'Auditoria', api],
        ['RF11', 'Exibir as fotos somente para a gestão autenticada', 'Proteger dados do cidadão', api],
        ['RF12', 'Autenticar gestores (login, logout, sessão atual)', 'Controle de acesso', api],
        ['RF13', 'Restringir funções por perfil (`admin`, `gestor`)', 'Autorização', api],
        ['RF14', 'Criar o primeiro administrador por comando interativo', 'Implantação sem credenciais no código', 'Implementado; digitação interativa real não validada'],
        ['RF15', 'Listar pontos de descarte ativos com filtros por tipo e material', 'Guia de reciclagem', api],
        ['RF16', 'Retornar os pontos mais próximos de uma posição (padrão 3, até 10)', 'Orientar o descarte', api],
        ['RF17', 'Cadastrar, editar e desativar pontos de descarte (somente `admin`)', 'Manter o guia atualizado', api],
        ['RF18', 'Listar veículos e rotas de coleta ativos', 'Acompanhamento da coleta', api],
        ['RF19', 'Simular e transmitir em tempo real a posição dos caminhões', 'Acompanhamento da coleta (demonstrativo)', api],
        ['RF20', 'Exibir mapa com caminhões, EcoPontos e cooperativas', 'Visualização geográfica', 'Implementado no protótipo com dados locais'],
        ['RF21', 'Simulador educativo de benefícios do descarte correto', 'Engajamento do cidadão', 'Implementado no protótipo (front-end)'],
    ], [1.3, 6.4, 4.0, 4.3], tamanho=8.5)
    h2('3.2 Requisitos não funcionais')
    tabela('Requisitos não funcionais', ['ID', 'Descrição', 'Finalidade', 'Situação'], [
        ['RNF01', 'Senhas com bcrypt (custo 12) e sessão em cookie `httpOnly`, `SameSite=Lax` (e `Secure` em produção)', 'Segurança da autenticação', 'Implementado e testado'],
        ['RNF02', 'Autorização por perfil em cada endpoint protegido', 'Segurança', 'Implementado e testado'],
        ['RNF03', 'Somente consultas SQL parametrizadas', 'Prevenir injeção de SQL', 'Implementado (revisado nos testes)'],
        ['RNF04', 'Validação de entradas com zod e de arquivos pelo conteúdo', 'Integridade e segurança', 'Implementado e testado'],
        ['RNF05', 'Limite de 10 tentativas malsucedidas por IP em 15 minutos no login e na consulta de protocolo', 'Prevenir força bruta e varredura', 'Implementado e testado (em memória)'],
        ['RNF06', 'CORS restrito às origens configuradas e verificação de `Origin` contra CSRF', 'Segurança', 'Implementado e testado'],
        ['RNF07', 'Segredos apenas em `server/.env` (não versionado)', 'Proteção de credenciais', 'Implementado e verificado'],
        ['RNF08', 'Banco no Supabase com RLS e sem privilégios para a Data API', 'Proteção dos dados', 'Implementado e verificado no Supabase'],
        ['RNF09', 'Conexão ao banco com TLS e certificado verificado', 'Confidencialidade', 'Implementado e verificado'],
        ['RNF10', 'Dados simulados marcados com `demonstrativo = true`; dado oficial exige `fonte`', 'Honestidade dos dados', 'Implementado (restrições no banco)'],
        ['RNF11', 'Atualização das posições a cada 3 s, com movimento contínuo', 'Experiência de tempo real', 'Implementado e testado'],
        ['RNF12', 'Testes automatizados sem tocar no banco oficial', 'Qualidade e segurança', 'Implementado (467 testes)'],
        ['RNF13', 'Interface responsiva e acessível (navegação por teclado, foco visível)', 'Usabilidade', 'Presente no protótipo; validação formal pendente'],
        ['RNF14', 'Funcionar no plano gratuito do Supabase, sem custos', 'Viabilidade acadêmica', 'Atendido (pool de 5 conexões)'],
    ], [1.4, 6.6, 3.7, 4.3], tamanho=8.5)


def capitulo_4():
    h1('4. Arquitetura da solução')
    h2('4.1 Visão geral')
    p('O EcoRecife adota uma arquitetura cliente-servidor em três camadas: o front-end (navegador), a API '
      '(servidor Node.js) e os serviços gerenciados do Supabase (banco PostgreSQL e Storage). O navegador nunca '
      'acessa o Supabase diretamente; todas as regras de negócio, a autenticação e o acesso aos dados ficam na API.')
    figura('01-arquitetura.png', 'Diagrama geral da arquitetura do EcoRecife', altura_max=18)
    h2('4.2 Separação entre front-end e back-end')
    topicos([
        '**Front-end (`web/`):** aplicação de página única em React 19, com navegação por âncoras (`#inicio`, '
        '`#coleta`, `#zeladoria`, `#ecopontos`, `#beneficios`, `#login`, `#gestao`), mapa Leaflet e componentes '
        'próprios. Hoje usa dados locais; no CP3 passará a chamar a API.',
        '**Back-end (`server/`):** API REST em Express 5 organizada por módulo: `auth/` (sessões e middlewares), '
        '`ocorrencias/` (registro, gestão e fotos), `pontos/` (guia de reciclagem), `coleta/` (veículos, rotas, '
        'simulador e tempo real), `banco/` (migrador, verificação e backup) e `rotas/` (roteadores HTTP).',
        '**Banco (`database/`):** migrações SQL versionadas (001 a 005) e seeds demonstrativos, aplicados pela própria '
        'API (`pnpm db:migrar` e `pnpm db:seed`).',
    ])
    h2('4.3 Comunicação entre as camadas e fluxo das requisições')
    p('Cada requisição HTTP passa pela mesma cadeia de proteção antes de chegar ao banco: cabeçalhos de segurança '
      '(helmet), CORS restrito, verificação de origem para métodos que alteram dados, limite de tentativas nas rotas '
      'sensíveis, validação com zod e, nas rotas protegidas, sessão e perfil. Os erros voltam sempre em JSON, sem '
      'detalhes internos.')
    figura('02-comunicacao.png', 'Comunicação entre navegador, API e Supabase')
    h2('4.4 Persistência, arquivos e serviços externos')
    topicos([
        '**Dados:** PostgreSQL 17 do Supabase, acessado pelo pacote `pg` através do Session pooler (porta 5432), com '
        'TLS verificado pela autoridade certificadora do Supabase.',
        '**Arquivos:** as fotografias ficam no Supabase Storage, num bucket privado; o banco guarda apenas a chave, '
        'o tipo e o tamanho.',
        '**Mapas:** o front-end usa os tiles do OpenStreetMap. As rotas demonstrativas foram calculadas uma única vez '
        '(29/10/2026) com o serviço público do OSRM sobre a malha do OpenStreetMap e gravadas no seed 002; a aplicação '
        'não faz chamadas ao OSRM em execução.',
    ])
    h2('4.5 Comunicação em tempo real')
    p('Ao iniciar, a API lê as rotas ativas e liga o motor da simulação. A cada 3 segundos, a posição de cada '
      'caminhão avança pelo trajeto e é transmitida a todos os clientes conectados pelo Socket.IO, no evento '
      '`coleta:posicoes`. O canal é somente de leitura: o servidor não trata mensagens dos clientes e confere a origem '
      'de cada conexão.')


def capitulo_5():
    h1('5. Tecnologias utilizadas')
    p('As versões abaixo são as declaradas nos arquivos `package.json` do front-end e da API.')
    tabela('Tecnologias do front-end', ['Tecnologia', 'Versão', 'Função no projeto'], [
        ['React', '^19.0.0', 'Construção da interface por componentes'],
        ['TypeScript', '^5.7.0', 'Tipagem estática do código do front-end'],
        ['Vite', '^8.0.5', 'Servidor de desenvolvimento e build de produção'],
        ['Tailwind CSS', '^4.0.0', 'Estilização utilitária e responsiva'],
        ['Leaflet + React Leaflet', '^1.9.4 / ^5.0.0', 'Mapa interativo com tiles do OpenStreetMap'],
        ['lucide-react', '^1.49.0', 'Ícones da interface'],
    ], [4.0, 3.2, 8.8])
    tabela('Tecnologias do back-end', ['Tecnologia', 'Versão', 'Função no projeto'], [
        ['Node.js', '22+', 'Ambiente de execução da API'],
        ['Express', '^5.3.0', 'Servidor HTTP e roteamento'],
        ['TypeScript + tsx', '^5.9.3 / ^4.23', 'Tipagem e execução direta do TypeScript'],
        ['pg', '^8.23.1', 'Conexão com o PostgreSQL (Supabase) e consultas parametrizadas'],
        ['zod', '^4.6.7', 'Validação de entradas e da configuração'],
        ['bcryptjs', '^3.0.3', 'Hash das senhas'],
        ['helmet / cors', '^8.3.0 / ^2.8.6', 'Cabeçalhos de segurança e CORS restrito'],
        ['express-rate-limit', '^8.7.1', 'Limite de tentativas no login e na consulta de protocolo'],
        ['multer / file-type', '^2.5.0 / ^22.2.0', 'Recebimento das fotos em memória e validação pelo conteúdo'],
        ['Socket.IO', '^4.8.4', 'Transmissão das posições dos caminhões em tempo real'],
    ], [4.0, 3.2, 8.8])
    tabela('Infraestrutura, serviços e ferramentas', ['Item', 'Função no projeto'], [
        ['Supabase Database (PostgreSQL 17, plano Free)', 'Banco de dados oficial'],
        ['Supabase Session pooler', 'Conexão IPv4 com sessão (exigida pela trava do migrador)'],
        ['Supabase Storage', 'Armazenamento privado das fotografias'],
        ['OpenStreetMap', 'Tiles do mapa e malha viária das rotas demonstrativas (licença ODbL)'],
        ['OSRM (servidor público de demonstração)', 'Cálculo único, em 29/10/2026, dos trajetos do seed 002'],
        ['Vitest + Supertest', 'Testes automatizados da API'],
        ['embedded-postgres', 'PostgreSQL descartável para os testes de integração (sem instalação)'],
        ['pnpm (via corepack)', 'Gerenciador de pacotes com lockfile'],
        ['Git e GitHub', 'Versionamento do código'],
    ], [6.0, 10.0])
    h2('5.1 Justificativas')
    topicos([
        '**React + Vite + TypeScript:** base herdada do protótipo, com build rápido e tipagem que reduz erros.',
        '**Express + TypeScript:** API simples, conhecida pela equipe e fácil de testar com Supertest.',
        '**PostgreSQL no Supabase:** banco relacional com restrições fortes (CHECK, FK, UNIQUE) e hospedagem gerenciada '
        'gratuita, sem servidor de banco na máquina dos integrantes.',
        '**Autenticação própria em vez do Supabase Auth:** já implementada e testada, com dois perfis internos e sem '
        'expor o banco ao navegador.',
        '**Haversine (`distancia_km`) em vez de PostGIS:** suficiente para dezenas de pontos, sem extensões.',
        '**Socket.IO:** comunicação em tempo real com reconexão automática e fallback para polling.',
    ])


def capitulo_6():
    h1('6. Modelagem do banco de dados')
    h2('6.1 Modelo conceitual')
    p('O domínio se divide em três grupos de entidades:')
    topicos([
        '**Zeladoria Cidadã:** uma **ocorrência** pertence a uma **categoria** e a um **bairro**, pode ter até três '
        '**fotos** e acumula um **histórico** de mudanças de status, cada uma registrada (ou não, no caso do cidadão) '
        'por um **usuário** da gestão.',
        '**Acesso:** um **usuário** (perfil `admin` ou `gestor`) pode ter várias **sessões** de login.',
        '**Reciclagem e coleta:** um **ponto de descarte** fica num bairro e aceita vários **materiais**; um **veículo** '
        'atende um bairro e percorre uma **rota**, formada por uma sequência ordenada de **pontos de rota**.',
    ])
    h2('6.2 Modelo lógico e diagramas entidade-relacionamento')
    p('O banco tem 14 tabelas no schema `public` (13 de domínio e a `schema_migrations`, de controle das migrações), '
      '6 tipos enumerados e 3 funções. Para manter os diagramas legíveis, eles foram divididos por área; os campos '
      'exibidos são os principais, e o dicionário de dados (seção 6.4) traz todos.')
    figura('03-er-zeladoria.png', 'Diagrama entidade-relacionamento – acesso e Zeladoria Cidadã', altura_max=19)
    figura('04-er-reciclagem-coleta.png', 'Diagrama entidade-relacionamento – reciclagem e coleta', altura_max=20)
    h2('6.3 Tipos enumerados, funções e gatilhos')
    tabela('Tipos enumerados (valores ASCII)', ['Tipo', 'Valores'], [
        ['perfil_usuario', 'admin, gestor'],
        ['status_ocorrencia', 'recebida, em_analise, equipe_designada, concluida'],
        ['prioridade_ocorrencia', 'urgente, alta, media, baixa'],
        ['origem_localizacao', 'gps, manual'],
        ['tipo_ponto_descarte', 'ecoponto, pev, cooperativa'],
        ['tipo_coleta', 'domiciliar, seletiva'],
    ], [5.0, 11.0])
    tabela('Funções e gatilhos', ['Objeto', 'Descrição'], [
        ['`distancia_km(lat1, lng1, lat2, lng2)`', 'Distância em km pela fórmula de Haversine (raio 6371,0088 km); usada nos pontos mais próximos'],
        ['`gerar_protocolo()`', 'Protocolo `ECO-AAAA-XXXX-XXXX` com 8 caracteres de bytes aleatórios de `gen_random_uuid()`, alfabeto de 32 símbolos sem ambíguos (≈ 1,1 trilhão de combinações por ano); valor padrão de `ocorrencias.protocolo`'],
        ['`definir_atualizado_em()`', 'Atualiza `atualizado_em` em todo UPDATE'],
        ['Gatilhos `*_atualizado_em`', 'Em `usuarios`, `ocorrencias` e `pontos_descarte` (BEFORE UPDATE)'],
    ], [5.5, 10.5])
    p('As três funções têm `search_path` fixo em `pg_catalog` e não podem ser executadas pelos papéis públicos '
      '(migração 005).')

    h2('6.4 Dicionário de dados')
    dic = [
        ('usuarios – gestores e administradores', [
            ['id', 'bigint (identity)', 'PK', 'Identificador'],
            ['nome', 'varchar(120)', 'NOT NULL, não vazio', 'Nome do usuário'],
            ['email', 'varchar(254)', 'NOT NULL, formato válido, único sem diferenciar maiúsculas', 'E-mail de login'],
            ['senha_hash', 'text', 'NOT NULL, ≥ 50 caracteres', 'Hash bcrypt da senha'],
            ['perfil', 'perfil_usuario', "NOT NULL, padrão 'gestor'", 'Perfil de acesso'],
            ['ativo', 'boolean', 'padrão true', 'Usuário inativo não autentica'],
            ['ultimo_login_em', 'timestamptz', '—', 'Último login'],
            ['criado_em / atualizado_em', 'timestamptz', 'padrão now()', 'Auditoria de registro'],
        ]),
        ('sessoes – sessões de login', [
            ['id', 'bigint (identity)', 'PK', 'Identificador'],
            ['usuario_id', 'bigint', 'FK usuarios, ON DELETE CASCADE', 'Dono da sessão'],
            ['token_hash', 'bytea', 'UNIQUE, exatamente 32 bytes', 'SHA-256 do token (o token não é guardado)'],
            ['criado_em / ultimo_uso_em', 'timestamptz', 'padrão now()', 'Criação e último uso'],
            ['expira_em', 'timestamptz', 'NOT NULL, > criado_em', 'Validade fixa da sessão'],
        ]),
        ('bairros', [
            ['id', 'integer (identity)', 'PK', 'Identificador'],
            ['nome', 'varchar(80)', 'NOT NULL, UNIQUE', 'Nome do bairro'],
            ['latitude / longitude', 'numeric(9,6)', 'NOT NULL, faixas válidas', 'Coordenadas aproximadas'],
            ['demonstrativo', 'boolean', 'padrão true', 'Marca de dado simulado'],
            ['fonte', 'text', 'obrigatória se não demonstrativo', 'Origem de dado oficial'],
        ]),
        ('categorias_ocorrencia', [
            ['id', 'smallint (identity)', 'PK', 'Identificador'],
            ['slug', 'varchar(40)', 'UNIQUE, [a-z0-9_]', 'Código (descarte, lixeira, entulho)'],
            ['nome', 'varchar(80)', 'UNIQUE', 'Nome exibido'],
            ['ativo', 'boolean', 'padrão true', 'Categoria disponível'],
        ]),
        ('ocorrencias – Zeladoria Cidadã (sem dado pessoal)', [
            ['id', 'bigint (identity)', 'PK', 'Identificador interno'],
            ['protocolo', 'varchar(20)', 'UNIQUE, padrão gerar_protocolo(), formato validado', 'Protocolo público'],
            ['categoria_id / bairro_id', 'smallint / integer', 'FK, NOT NULL', 'Classificação e local'],
            ['endereco', 'varchar(200)', 'NOT NULL, não vazio', 'Endereço ou referência'],
            ['descricao', 'varchar(1000)', 'NOT NULL, não vazio', 'Relato do cidadão'],
            ['latitude / longitude', 'numeric(9,6)', 'juntas ou ambas nulas', 'Posição opcional'],
            ['origem_localizacao / precisao_m', 'enum / numeric(8,1)', 'só com coordenada; precisão ≥ 0', 'GPS ou manual'],
            ['status', 'status_ocorrencia', "padrão 'recebida'", 'Situação do atendimento'],
            ['prioridade', 'prioridade_ocorrencia', "padrão 'media'", 'Prioridade da gestão'],
            ['concluido_em / nota_conclusao', 'timestamptz / varchar(500)', 'só quando concluída', 'Encerramento'],
            ['demonstrativo', 'boolean', 'padrão false', 'Exemplos do seed = true'],
            ['criado_em / atualizado_em', 'timestamptz', 'padrão now()', 'Auditoria de registro'],
        ]),
        ('ocorrencia_fotos', [
            ['id', 'uuid', 'PK, gen_random_uuid()', 'Identificador'],
            ['ocorrencia_id', 'bigint', 'FK, ON DELETE CASCADE', 'Ocorrência dona da foto'],
            ['ordem', 'smallint', '1 a 3, única por ocorrência', 'Limita a 3 fotos'],
            ['chave_armazenamento', 'text', 'UNIQUE', 'Chave no Storage (ocorrencias/<uuid>.<ext>)'],
            ['tipo_mime', 'varchar(20)', 'image/jpeg, image/png ou image/webp', 'Tipo detectado pelo conteúdo'],
            ['tamanho_bytes', 'integer', '1 a 5.242.880', 'Até 5 MB'],
        ]),
        ('ocorrencia_historico – somente inserção', [
            ['id', 'bigint (identity)', 'PK', 'Identificador'],
            ['ocorrencia_id', 'bigint', 'FK, ON DELETE CASCADE', 'Ocorrência'],
            ['status_anterior / status_novo', 'status_ocorrencia', 'devem ser diferentes', 'Transição registrada'],
            ['usuario_id', 'bigint', 'FK, ON DELETE SET NULL; nulo = cidadão', 'Responsável pela mudança'],
            ['observacao', 'varchar(500)', '—', 'Nota interna (não é pública)'],
            ['criado_em', 'timestamptz', 'padrão now()', 'Momento da mudança'],
        ]),
        ('pontos_descarte – EcoPontos, PEVs e cooperativas', [
            ['id', 'integer (identity)', 'PK', 'Identificador'],
            ['tipo', 'tipo_ponto_descarte', 'NOT NULL; (tipo, nome) único', 'Tipo do ponto'],
            ['nome / bairro_id', 'varchar(120) / integer', 'NOT NULL; FK bairros', 'Identificação e local'],
            ['latitude / longitude', 'numeric(9,6)', 'NOT NULL', 'Posição'],
            ['endereco, horario_funcionamento, situacao, telefone, email, site', 'varchar', 'opcionais', 'Informações ao cidadão'],
            ['demonstrativo / fonte / verificado_em', 'boolean / text / date', 'fonte obrigatória se não demonstrativo', 'Procedência do dado'],
            ['ativo', 'boolean', 'padrão true', 'Exclusão lógica'],
        ]),
        ('materiais e ponto_materiais', [
            ['materiais.id / slug / nome', 'smallint / varchar', 'PK; slug e nome únicos', 'Material aceito'],
            ['ponto_materiais.ponto_id', 'integer', 'PK composta, FK CASCADE', 'Ponto'],
            ['ponto_materiais.material_id', 'smallint', 'PK composta, FK RESTRICT', 'Material'],
        ]),
        ('veiculos, rotas e rota_pontos – coleta (demonstrativa)', [
            ['veiculos.codigo', 'varchar(10)', 'UNIQUE', 'Código público (ex.: #04)'],
            ['veiculos.tipo_coleta / bairro_id / ativo', 'enum / integer / boolean', 'FK bairros opcional', 'Tipo, área e situação'],
            ['rotas.nome / veiculo_id / ativa', 'varchar(120) / integer / boolean', 'nome único; FK SET NULL', 'Rota do veículo'],
            ['rota_pontos.rota_id / ordem', 'integer', 'PK composta; ordem ≥ 1', 'Sequência do trajeto'],
            ['rota_pontos.latitude / longitude', 'numeric(9,6)', 'NOT NULL', 'Coordenada do trajeto'],
            ['demonstrativo (veículos e rotas)', 'boolean', 'padrão true', 'Sem integração com a frota'],
        ]),
    ]
    for titulo, linhas in dic:
        h3(titulo)
        tabela(f'Dicionário de dados – {titulo.split(" – ")[0]}', ['Campo', 'Tipo', 'Restrições', 'Descrição'], linhas,
               [4.2, 3.4, 4.6, 3.8], tamanho=8.5)

    h2('6.5 Índices e regras de integridade')
    tabela('Índices além das chaves primárias e únicas', ['Índice', 'Finalidade'], [
        ['ocorrencias (status, criado_em DESC)', 'Fila da gestão por status, da mais recente'],
        ['ocorrencias (bairro_id) e (categoria_id)', 'Filtros da gestão'],
        ['ocorrencia_historico (ocorrencia_id, criado_em)', 'Linha do tempo de uma ocorrência'],
        ['ocorrencia_historico (usuario_id) parcial', 'Ações de um usuário'],
        ['pontos_descarte (tipo) parcial WHERE ativo; (bairro_id)', 'Guia de reciclagem'],
        ['ponto_materiais (material_id)', 'Filtro por material'],
        ['veiculos (bairro_id); rotas (veiculo_id)', 'Coleta'],
        ['sessoes (usuario_id); sessoes (expira_em)', 'Logout e limpeza de sessões expiradas'],
        ['usuarios lower(email) único', 'E-mail único sem diferenciar maiúsculas'],
    ], [7.5, 8.5])
    topicos([
        'Conclusão coerente: `concluido_em` existe se, e somente se, o status for `concluida`; a nota só existe em ocorrência concluída.',
        'Coordenadas completas: latitude e longitude andam juntas, e a origem da localização só existe com coordenada.',
        'Histórico: toda linha registra uma troca real de status (`historico_muda_status`).',
        'Procedência: bairro ou ponto não demonstrativo exige `fonte`.',
        'Fotos: no máximo 3 por ocorrência, só jpeg/png/webp, até 5 MB.',
        'A verificação `database/queries/verificar_restricoes.sql` testa 24 casos dessas regras (24/24 aprovados no Supabase).',
    ])


def capitulo_7():
    h1('7. Banco de dados e persistência')
    h2('7.1 Supabase como infraestrutura oficial')
    p('Desde 10/11/2026, o banco oficial do EcoRecife é o PostgreSQL 17 gerenciado pelo Supabase (plano Free, '
      'região us-west-2). Os dados demonstrativos do antigo banco local foram migrados a partir de um backup validado, '
      'com os mesmos identificadores, datas e sequências, e o PostgreSQL local foi desinstalado. As fotografias ficam no '
      'Supabase Storage.')
    p('**O projeto não usa o Supabase Auth.** A autenticação é própria, implementada na API (capítulo 8), e o '
      'navegador não acessa o Supabase.')
    h2('7.2 Estratégia de conexão')
    topicos([
        'Pacote `pg` com pool de no máximo 5 conexões, adequado ao plano gratuito.',
        'Session pooler (IPv4, porta 5432); o Transaction pooler (porta 6543) é recusado pela configuração, pois o '
        'migrador usa uma trava consultiva de sessão.',
        'TLS com o certificado verificado pela autoridade certificadora do Supabase (`server/certs/prod-ca-2021.crt`), '
        'sem desativar a verificação.',
        'A configuração recusa qualquer banco que não seja o Supabase e informa nos logs o projeto em uso, sem segredos.',
    ])
    h2('7.3 Migrações e seeds')
    tabela('Migrações e seeds', ['Arquivo', 'Conteúdo'], [
        ['001_tipos_e_funcoes', 'Controle `schema_migrations`, tipos enumerados e funções'],
        ['002_tabelas', 'Tabelas do domínio e restrições'],
        ['003_indices_e_gatilhos', 'Índices e gatilhos de `atualizado_em`'],
        ['004_sessoes', 'Tabela de sessões de login'],
        ['005_seguranca', 'RLS em todas as tabelas, revogação de privilégios da Data API e `search_path` das funções'],
        ['seed 001', '16 bairros, 3 categorias, 6 materiais, 10 pontos, 7 veículos e 8 ocorrências de exemplo (demonstrativos)'],
        ['seed 002', '7 rotas demonstrativas com 1.178 pontos (OpenStreetMap via OSRM)'],
    ], [4.5, 11.5])
    p('O migrador (`pnpm db:migrar`) valida os arquivos antes de conectar, aplica cada migração numa transação '
      'própria, nunca apaga dados, recusa estados inconsistentes e impede execuções simultâneas. O `pnpm db:seed` só '
      'roda num banco vazio, e o `pnpm db:seed-rotas` carrega as rotas num banco já instalado sem alterar rotas existentes.')
    h2('7.4 Integridade, backup e restauração')
    topicos([
        '`pnpm db:verificar` confere TLS, migrações, as 14 tabelas, RLS, ausência de policies, privilégios, funções, '
        'registros órfãos e sequências; `--restricoes` executa os 24 casos de restrição numa transação desfeita.',
        '`pnpm db:backup` gera um backup dos dados em SQL puro, fora do repositório, com SHA-256; `pnpm db:restaurar` '
        'recarrega um backup apenas num banco com as mesmas migrações e as tabelas vazias.',
        'O plano Free não oferece backups para download e pausa o projeto após 7 dias sem uso; por isso os backups são '
        'manuais e documentados em `docs/03-banco-de-dados.md`.',
    ])
    h2('7.5 Restrições de acesso, RLS e Data API')
    p('O Supabase publica o schema `public` pela Data API (PostgREST). Como o EcoRecife não usa essa interface, a '
      'migração 005 liga a RLS em todas as 14 tabelas **sem nenhuma policy** e retira todos os privilégios dos papéis '
      '`anon`, `authenticated` e `service_role`, inclusive para objetos criados depois. Só a API, dona das tabelas, lê '
      'e grava. Em 10/11/2026, uma verificação externa com a chave pública recebeu HTTP 401 em todas as tabelas.')


def capitulo_8():
    h1('8. Autenticação e segurança')
    p('Os mecanismos abaixo estão implementados na API e cobertos por testes. Nenhum segredo é descrito: senhas, '
      'chaves e strings de conexão ficam apenas em `server/.env`, que não é versionado.')
    figura('08-autenticacao.png', 'Fluxo de autenticação e sessão', altura_max=15)
    tabela('Mecanismos de segurança implementados', ['Mecanismo', 'Como funciona'], [
        ['Login e logout', 'E-mail e senha verificados com bcrypt; mensagem de erro única; o logout apaga a sessão no banco e limpa o cookie'],
        ['Sessões', 'Token aleatório de 32 bytes; o banco guarda só o SHA-256; validade fixa (`SESSAO_HORAS`, padrão 8 h); a sessão cai no logout, na expiração ou ao desativar o usuário'],
        ['Cookie', '`HttpOnly`, `SameSite=Lax`, `Path=/`; em produção, `Secure` e prefixo `__Host-`'],
        ['Controle por perfil', 'Middlewares `exigirSessao` (401) e `exigirPerfil` (403) em cada rota protegida'],
        ['Validação de entradas', 'Esquemas zod em corpos, filtros e parâmetros; corpo JSON limitado a 100 kB'],
        ['Arquivos', 'Upload em memória; tipo detectado pelo conteúdo (file-type); só jpeg/png/webp, até 5 MB, no máximo 3'],
        ['Limite de tentativas', '10 falhas por IP a cada 15 min no login e na consulta de protocolo (HTTP 429)'],
        ['CORS', 'Somente as origens de `CORS_ORIGENS`, sem curinga'],
        ['CSRF', 'POST/PUT/PATCH/DELETE recusados (403) quando a origem não é permitida'],
        ['Cabeçalhos', 'helmet (CSP, nosniff etc.) e `Cache-Control: no-store` em dados sensíveis'],
        ['Fotografias', 'Bucket privado; acesso só pela rota protegida, que confere se a foto pertence à ocorrência'],
        ['Banco', 'Consultas parametrizadas; RLS sem policies; nenhum privilégio para a Data API'],
        ['Tempo real', 'Socket.IO somente leitura, com origem conferida e mensagens de até 1 kB'],
    ], [3.8, 12.2], tamanho=8.5)
    p('**Limitações conhecidas:** os contadores do limite de tentativas ficam em memória (zeram ao reiniciar a API); '
      'atrás de um proxy reverso será preciso configurar o `trust proxy`; e o cookie `SameSite=Lax` exige front-end e '
      'API no mesmo site na implantação.')


def capitulo_9():
    h1('9. Fluxos principais do sistema')
    h2('9.1 Registro de ocorrência e geração do protocolo')
    p('O cidadão envia o formulário com até três fotos. A API valida tudo antes de gravar e, numa única transação, '
      'cria a ocorrência (o protocolo é gerado pelo banco), registra a primeira linha do histórico e envia as fotos ao '
      'Storage. Se algo falhar, a transação é desfeita e as fotos já enviadas são removidas.')
    figura('05-registro-ocorrencia.png', 'Fluxograma do registro de ocorrência', altura_max=15.5)
    h2('9.2 Consulta pública pelo protocolo')
    p('`GET /api/ocorrencias/protocolo/:protocolo` devolve apenas protocolo, categoria, bairro, status, datas e a linha '
      'do tempo de status, sem endereço, descrição, fotos ou observações internas. Consultas malsucedidas contam para o '
      'limite de tentativas.')
    h2('9.3 Atendimento pela gestão e histórico')
    p('O gestor altera o status dentro de uma transação que trava a linha da ocorrência, valida a transição e registra '
      'o histórico com o usuário da sessão. Transições não permitidas retornam 409.')
    figura('07-atendimento.png', 'Sequência de atendimento de uma ocorrência', altura_max=12)
    figura('06-status-ocorrencia.png', 'Ciclo de vida do status da ocorrência', altura_max=11)
    h2('9.4 Fotografias protegidas')
    p('A rota `GET /api/ocorrencias/:id/fotos/:fotoId` exige sessão e perfil, confere se a foto pertence à ocorrência e '
      'se a chave tem o formato esperado, lê o arquivo do bucket privado com a chave secreta do servidor e o entrega com '
      '`Cache-Control: private, no-store`.')
    h2('9.5 Pontos de reciclagem e pontos próximos')
    p('`GET /api/pontos` lista os pontos ativos com filtros por tipo e material. `GET /api/pontos/proximos?lat&lng` '
      'calcula a distância com `distancia_km` e devolve os mais próximos (padrão 3). Do Derby (-8,0570; -34,8990), por '
      'exemplo, o resultado com os dados demonstrativos é: EcoPonto Torre (1,61 km), Cooperativa Novo Ciclo (1,85 km) e '
      'EcoPonto Centro / Santo Antônio (1,95 km).')
    h2('9.6 Rotas e simulação dos veículos')
    p('`GET /api/rotas` devolve as 7 rotas ativas com os pontos em ordem. A simulação percorre esses trajetos a uma '
      'velocidade demonstrativa de 20 km/h, interpolando a posição entre pontos para evitar saltos, e transmite as '
      'posições a cada 3 segundos.')
    figura('09-simulacao.png', 'Funcionamento da simulação dos veículos', altura_max=16)


def capitulo_10():
    h1('10. Instalação, configuração e execução')
    h2('10.1 Pré-requisitos')
    topicos([
        'Node.js 22 ou superior e pnpm (pelo `corepack`, que acompanha o Node).',
        'Git, para clonar o repositório.',
        'Acesso ao projeto do Supabase (senha do banco e secret key), concedido pelo responsável. **Não é preciso '
        'instalar PostgreSQL**, nem para a API nem para os testes.',
    ])
    h2('10.2 Organização das pastas')
    codigo([
        'EcoRecife/',
        '├── web/                 front-end (React + Vite)',
        '├── server/              API (Express + TypeScript + Socket.IO)',
        '│   ├── src/             código da API',
        '│   ├── test/            testes automatizados',
        '│   └── certs/           certificado público da CA do Supabase',
        '├── database/',
        '│   ├── migrations/      001 a 005',
        '│   ├── seeds/           dados demonstrativos e rotas',
        '│   └── queries/         verificação de restrições e consultas de teste',
        '└── docs/                documentação (esta incluída)',
    ])
    h2('10.3 Configuração do back-end')
    codigo([
        'cd server',
        'corepack pnpm install --frozen-lockfile',
        'Copy-Item .env.example .env      # depois, preencha o .env',
    ])
    p('As variáveis estão descritas em `server/.env.example`. Os valores secretos (senha do banco e secret key do '
      'Supabase) são preenchidos apenas no `.env` local, nunca no código ou na documentação.')
    tabela('Variáveis de ambiente da API', ['Variável', 'Finalidade'], [
        ['DATABASE_URL', 'Connection string do Session pooler do Supabase (contém a senha: só no .env)'],
        ['DATABASE_SSL_CA', 'Certificado da CA do Supabase (padrão `certs/prod-ca-2021.crt`)'],
        ['SUPABASE_URL / SUPABASE_SECRET_KEY', 'Projeto e chave secreta para o Storage (a chave é segredo)'],
        ['SUPABASE_BUCKET_FOTOS', 'Bucket privado das fotos (padrão `ocorrencias-fotos`)'],
        ['PORTA, NODE_ENV, CORS_ORIGENS, SESSAO_HORAS', 'Porta (3333), ambiente, origens do front e duração da sessão'],
        ['SIMULACAO_ATIVA, SIMULACAO_INTERVALO_MS', 'Liga a simulação e define o intervalo (3000 ms)'],
    ], [6.0, 10.0])
    h2('10.4 Banco, armazenamento e primeiro administrador')
    codigo([
        'corepack pnpm db:status            # migrações aplicadas e pendentes',
        'corepack pnpm db:migrar            # aplica as migrações 001 a 005',
        'corepack pnpm db:seed              # só em banco vazio: dados demonstrativos e rotas',
        'corepack pnpm db:verificar --restricoes',
        'corepack pnpm storage:preparar     # cria/ajusta o bucket privado',
        'corepack pnpm storage:verificar',
        'corepack pnpm criar-admin          # interativo',
    ])
    h2('10.5 Execução')
    codigo([
        '# API (pasta server/)',
        'corepack pnpm dev                  # http://localhost:3333',
        'Invoke-RestMethod http://localhost:3333/api/saude',
        '',
        '# Front-end (pasta web/)',
        'pnpm install --frozen-lockfile',
        'pnpm dev                           # http://localhost:5173',
    ])
    p('Ao subir, a API registra no log o projeto Supabase em uso, o bucket de fotos e a simulação ativa com 7 '
      'veículos. `GET /api/saude` responde `{"status":"ok","banco":"conectado"}` quando o banco está acessível.')
    h2('10.6 Testes')
    codigo([
        'cd server',
        'corepack pnpm test                 # sobe um PostgreSQL descartável; nunca usa o Supabase',
        'corepack pnpm typecheck',
        'corepack pnpm build',
    ])


def capitulo_11():
    h1('11. Testes e validação')
    h2('11.1 Estratégia e ferramentas')
    topicos([
        '**Vitest + Supertest:** testes da API com um banco falso em memória (unidade e HTTP) e com PostgreSQL real '
        '(integração).',
        '**PostgreSQL descartável:** o `globalSetup` do Vitest sobe um PostgreSQL 17 (`embedded-postgres`) só em '
        '127.0.0.1, numa porta livre e com dados temporários; cada teste de integração cria e apaga um banco '
        '`ecorecife_teste_*`.',
        '**Travas:** os testes recusam `NODE_ENV=production`, qualquer host do Supabase e o mesmo banco de `DATABASE_URL`.',
        '**Testes de mutação:** trechos críticos foram removidos de propósito para confirmar que os testes falham '
        '(por exemplo, sem `exigirPerfil` 7 testes falham; sem as revogações da migração 005, 9 falham).',
    ])
    h2('11.2 Resultados registrados')
    p('Execução de `corepack pnpm test` em 12/11/2026 (Windows 11, Node 24.22, pnpm 12.15): **467 de 467 testes '
      'aprovados em 23 arquivos**; `typecheck` e `build` da API e do front-end sem erros.')
    tabela('Testes automatizados por arquivo (12/11/2026)', ['Arquivo', 'Escopo', 'Aprovados'], [
        ['auth.test.ts / auth.integracao.test.ts', 'Login, cookie, sessão, expiração, perfis, CSRF, limite', '36 / 7'],
        ['ocorrencias.test.ts / .integracao', 'Registro, fotos, protocolo, rollback', '49 / 6'],
        ['gestao-ocorrencias.test.ts / .integracao', 'Listagem, filtros, transições, histórico, fotos', '76 / 25'],
        ['pontos.test.ts / .integracao', 'Guia, próximos, cadastro do admin', '40 / 16'],
        ['coleta.test.ts / .integracao', 'Veículos e rotas', '15 / 6'],
        ['simulador.test.ts', 'Motor da simulação (relógio falso)', '40'],
        ['tempo-real.test.ts', 'Socket.IO, origem, encerramento', '16'],
        ['seed-rotas.test.ts / .integracao', 'Carga segura das rotas', '8 / 11'],
        ['seguranca.integracao.test.ts', 'RLS e privilégios da Data API (migração 005)', '11'],
        ['backup.integracao.test.ts', 'Backup e restauração', '3'],
        ['armazenamento-supabase.test.ts', 'Storage (sem rede)', '9'],
        ['config.test.ts', 'Configuração e recusas', '45'],
        ['migrador.test.ts / integracao.test.ts', 'Migrações e seeds', '14 / 10'],
        ['administrador.test.ts', 'Criação do administrador', '11'],
        ['app.test.ts / banco-temporario.test.ts', 'Aplicação HTTP e travas de teste', '6 / 7'],
        ['Total', '23 arquivos', '467'],
    ], [6.2, 7.3, 2.5], tamanho=8.5)
    h2('11.3 Validação no Supabase (10/11/2026)')
    topicos([
        '`db:verificar --restricoes --data-api`: todas as verificações OK, 24/24 restrições e HTTP 401 da Data API nas 14 tabelas.',
        '`storage:verificar`: bucket privado, envio e leitura pela API, URL pública sem acesso e tipo não permitido recusado.',
        'Teste ponta a ponta com a API real contra o Supabase: 42 de 42 verificações (autenticação, ocorrências com foto, '
        'gestão, reciclagem, coleta e Socket.IO), com os registros temporários apagados ao final.',
        'Migração dos dados: tabelas idênticas ao banco original por contagem, identificadores, sequências e assinatura MD5.',
    ])
    p('**Não verificado:** a integração do front-end com a API (CP3), o uso no navegador com dados reais, o comando '
      '`criar-admin` digitado num terminal interativo e o encerramento por Ctrl+C no terminal.')


def capitulo_12():
    h1('12. Status de implementação e trabalhos futuros')
    tabela('Status de implementação', ['Situação', 'Itens'], [
        ['Implementado e testado', 'API completa da Zeladoria (registro, protocolo, consulta, gestão, histórico, fotos); '
         'autenticação e perfis; guia de reciclagem; veículos, rotas, simulação e Socket.IO; banco no Supabase com RLS; '
         'Storage privado; verificação e backup'],
        ['Implementado, mas não validado integralmente', 'Comando `criar-admin` interativo; protótipo do front-end '
         '(responsividade e acessibilidade sem validação formal); procedimento de recriar o banco do zero (documentado, '
         'não executado no projeto oficial)'],
        ['Em desenvolvimento (CP3)', 'Integração do front-end com a API: login real, envio de ocorrências, painel de '
         'gestão, guia e mapa com a simulação em tempo real'],
        ['Planejado', 'Tela pública de consulta por protocolo; implantação (domínio, HTTPS, proxy com WebSocket, '
         '`trust proxy`); apresentação final (01 a 08/12/2026)'],
    ], [4.6, 11.4], tamanho=9)
    h2('12.1 Limitações conhecidas')
    topicos([
        'Todos os dados de coleta, pontos e ocorrências de exemplo são demonstrativos; não há integração com a frota ou '
        'com sistemas da Prefeitura.',
        'O limite de tentativas fica em memória e zera quando a API reinicia.',
        'As fotos mantêm os metadados EXIF (protegidas por acesso restrito).',
        'Plano Free do Supabase: pausa após 7 dias sem uso, sem backups para download, região us-west-2 (latência maior '
        'a partir do Recife).',
        'A API deve rodar em uma única instância (simulação e limites em memória).',
    ])
    h2('12.2 Sugestões de melhoria (não implementadas)')
    topicos([
        'Remover os metadados EXIF das fotos no upload.',
        'Armazenamento compartilhado para o limite de tentativas, se houver mais de uma instância.',
        'Endpoint público de materiais e visão agregada por bairro para o painel.',
        'Cadastro de pontos de descarte oficiais com fonte verificada junto à Prefeitura/Emlurb.',
    ])


def capitulo_13():
    h1('13. Conclusão')
    p('O EcoRecife transformou o protótipo da AV1 numa base técnica real: uma API segura e testada, com banco de dados '
      'relacional modelado com restrições fortes, hospedado no Supabase, fotografias em armazenamento privado e '
      'comunicação em tempo real para a simulação da coleta. Até o Checkpoint 2, os endpoints principais e a conexão '
      'com o banco estão concluídos e validados, com 467 testes automatizados aprovados e uma verificação ponta a ponta '
      'no ambiente oficial.')
    p('A arquitetura em camadas, com o front-end falando apenas com a API, concentra as regras de negócio e a '
      'segurança num único ponto, o que protege os dados do cidadão – anônimo e acompanhado apenas pelo protocolo – e '
      'facilita a evolução. A marcação explícita dos dados demonstrativos mantém a honestidade da proposta perante a '
      'Prefeitura e os avaliadores.')
    p('Entre os aprendizados técnicos estão a modelagem orientada a regras de integridade, a autenticação baseada em '
      'sessões, o controle de acesso por perfil, a proteção de um banco gerenciado exposto por padrão (RLS e '
      'privilégios), a migração de dados com validação e os testes isolados do ambiente oficial.')
    p('O próximo passo é o Checkpoint 3: integrar o front-end à API para entregar a aplicação funcional completa. Os '
      'benefícios esperados – mais transparência, orientação ao descarte correto e apoio à priorização da zeladoria – '
      'dependem dessa integração e de dados oficiais, e ainda não foram medidos.')


def referencias():
    titulo_sem_numero('Referências')
    for ref in [
        'ECORECIFE. Repositório do projeto. Disponível em: https://github.com/ac1oli/EcoRecife. Acesso em: 12 nov. 2026.',
        'ECORECIFE. Documentação do repositório: docs/02-modelagem-banco.md, docs/03-banco-de-dados.md, '
        'docs/04-plano-execucao.md, docs/06-api.md e docs/CONTINUIDADE.md. 2026.',
        'UNINASSAU. Projeto Prático AV2 – Desafios do Banco de Oportunidades (Implementação). Edital de Convocação nº 02/2026.2.',
        'SUPABASE. Documentação oficial. Disponível em: https://supabase.com/docs.',
        'POSTGRESQL GLOBAL DEVELOPMENT GROUP. PostgreSQL 17 Documentation. Disponível em: https://www.postgresql.org/docs/17/.',
        'OPENSTREETMAP. Copyright and License (ODbL). Disponível em: https://www.openstreetmap.org/copyright.',
        'PROJECT OSRM. Open Source Routing Machine. Disponível em: https://project-osrm.org/.',
        'EXPRESS. Documentação. Disponível em: https://expressjs.com/.',
        'SOCKET.IO. Documentação. Disponível em: https://socket.io/docs/v4/.',
        'REACT. Documentação. Disponível em: https://react.dev/.',
        'MERMAID. Documentação. Disponível em: https://mermaid.js.org/.',
    ]:
        paragrafo = p(ref)
        paragrafo.alignment = WD_ALIGN_PARAGRAPH.LEFT
        paragrafo.paragraph_format.space_after = Pt(8)
        paragrafo.paragraph_format.line_spacing = 1.0


def apendice():
    titulo_sem_numero('Apêndice A – Endpoints da API')
    tabela('Endpoints da API', ['Método e rota', 'Acesso', 'Finalidade'], [
        ['GET /api/saude', 'Público', 'Saúde da API e do banco'],
        ['POST /api/auth/login', 'Público, com limite', 'Login'],
        ['GET /api/auth/eu', 'Sessão', 'Usuário autenticado'],
        ['POST /api/auth/logout', 'Público', 'Logout'],
        ['POST /api/ocorrencias', 'Público', 'Registro de ocorrência com fotos'],
        ['GET /api/ocorrencias/protocolo/:protocolo', 'Público, com limite', 'Consulta pública'],
        ['GET /api/ocorrencias, GET /api/ocorrencias/:id', 'admin/gestor', 'Listagem e detalhe'],
        ['PATCH /:id/status, POST /:id/concluir, POST /:id/reabrir, PATCH /:id/prioridade', 'admin/gestor', 'Atendimento'],
        ['GET /api/ocorrencias/:id/fotos/:fotoId', 'admin/gestor', 'Foto protegida'],
        ['GET /api/pontos, GET /api/pontos/proximos', 'Público', 'Guia de reciclagem'],
        ['GET /api/pontos/gestao, GET/POST/PATCH/DELETE /api/pontos/:id', 'admin', 'Cadastro de pontos (DELETE desativa)'],
        ['GET /api/veiculos, GET /api/rotas', 'Público', 'Coleta'],
        ['Socket.IO /socket.io/ – evento coleta:posicoes', 'Público, só leitura', 'Posições em tempo real'],
    ], [7.6, 3.4, 5.0], tamanho=8.5, fonte='Fonte: docs/06-api.md e server/src/rotas/ (2026).')
    p('Os arquivos-fonte dos diagramas (Mermaid) estão em `docs/documentacao-tecnica/diagramas/`, e este documento é '
      'gerado por `docs/documentacao-tecnica/gerar_documentacao.py`.')


# ---------------------------------------------------------------------------

def principal():
    configurar_estilos()
    secao = doc.sections[0]
    configurar_pagina(secao)
    cabecalho_rodape(secao)
    capa()
    sumario_e_listas()
    for capitulo in (capitulo_1, capitulo_2, capitulo_3, capitulo_4, capitulo_5, capitulo_6, capitulo_7, capitulo_8,
                     capitulo_9, capitulo_10, capitulo_11, capitulo_12, capitulo_13):
        capitulo()
    referencias()
    apendice()
    props = doc.core_properties
    props.title = 'EcoRecife – Documentação Técnica'
    props.subject = 'Arquitetura da Solução – Projeto Prático AV2 (UNINASSAU 2026.2)'
    props.author = 'Equipe EcoRecife'
    props.language = 'pt-BR'
    doc.save(SAIDA)
    print(f'Gerado: {SAIDA}')


if __name__ == '__main__':
    principal()
