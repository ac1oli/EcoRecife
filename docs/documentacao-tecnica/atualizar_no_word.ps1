# Abre o .docx no Microsoft Word, atualiza o sumário, as listas de figuras e tabelas e os
# demais campos (numeração de páginas e legendas), salva e exporta um PDF de conferência.
# Uso: powershell -File docs/documentacao-tecnica/atualizar_no_word.ps1 [-Pdf <caminho>]
param(
  [string]$Docx = (Join-Path $PSScriptRoot '..\Documentacao_Tecnica_EcoRecife.docx'),
  [string]$Pdf = ''
)
$Docx = (Resolve-Path $Docx).Path
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Docx, $false, $false)
  $doc.Fields.Update() | Out-Null
  foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
  foreach ($tof in $doc.TablesOfFigures) { $tof.Update() }
  $doc.Repaginate()
  foreach ($toc in $doc.TablesOfContents) { $toc.UpdatePageNumbers() }
  foreach ($tof in $doc.TablesOfFigures) { $tof.UpdatePageNumbers() }
  $paginas = $doc.ComputeStatistics(2)
  $doc.Save()
  if ($Pdf) { $doc.ExportAsFixedFormat($Pdf, 17) }
  "Páginas: $paginas · Sumários: $($doc.TablesOfContents.Count) · Listas: $($doc.TablesOfFigures.Count) · Figuras: $($doc.InlineShapes.Count) · Tabelas: $($doc.Tables.Count)"
  $doc.Close()
} finally {
  $word.Quit()
}
