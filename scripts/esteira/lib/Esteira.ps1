# Esteira.ps1 — lib compartilhada dos scripts da esteira -base.
# Dot-source: . "$PSScriptRoot/lib/Esteira.ps1"
#
# Único lugar que sabe LER o esteira.json. Todo script recebe daqui um objeto com os
# caminhos já resolvidos; nenhum script escreve repo, remote, branch ou raiz no próprio texto.

Set-StrictMode -Version Latest

function Find-EsteiraRoot {
  <# Sobe a partir de $Start até achar esteira.json. Devolve a pasta, ou $null. #>
  param([string]$Start)
  $dir = (Resolve-Path $Start).Path
  while ($dir) {
    if (Test-Path (Join-Path $dir 'esteira.json')) { return $dir }
    $parent = Split-Path $dir -Parent
    if (-not $parent -or $parent -eq $dir) { return $null }
    $dir = $parent
  }
  return $null
}

function Get-Esteira {
  <#
  .SYNOPSIS  Lê e valida o esteira.json; devolve caminhos resolvidos.
  .OUTPUTS   [pscustomobject] com:
             Projeto, Repo, Remote, BranchBase, WtRoot, Codigo, CoordenacaoIssue, NotebookLmId, VaultDir,
             PastasProibidas, Labels, RepoRoot (pasta do esteira.json), CodigoRoot (RepoRoot/Codigo),
             FrentesDir (registro das frentes)
  #>
  param([string]$Start = (Get-Location).Path)

  $root = Find-EsteiraRoot $Start
  if (-not $root) {
    throw "esteira.json não encontrado subindo a partir de '$Start'. Este não é um projeto da esteira -base (ou você está fora dele)."
  }
  $cfgPath = Join-Path $root 'esteira.json'
  try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json }
  catch { throw "esteira.json inválido em $cfgPath : $_" }

  foreach ($campo in 'projeto','repo','remote','branch_base','wt_root','codigo','coordenacao_issue') {
    if (-not $cfg.PSObject.Properties[$campo]) { throw "esteira.json sem o campo obrigatório '$campo' ($cfgPath)" }
  }
  if ($cfg.projeto -notmatch '^[a-z0-9][a-z0-9._-]*$') { throw "esteira.json: 'projeto' deve ser slug minúsculo (recebi '$($cfg.projeto)')" }
  if ($cfg.repo    -notmatch '^[^/\s]+/[^/\s]+$')      { throw "esteira.json: 'repo' deve ser owner/repo (recebi '$($cfg.repo)')" }
  if ($cfg.wt_root -notmatch '^[A-Za-z]:/')            { throw "esteira.json: 'wt_root' deve ser caminho absoluto com barras normais, ex. C:/base-wt/x (recebi '$($cfg.wt_root)')" }
  # Adaptação local (2026-09-11): checagem nominal por nome de OUTRO projeto removida — repositório público.
  # A proteção equivalente é estrutural: wt_root tem de terminar no slug deste projeto (linha abaixo).
  # issue #14: normalizado, ≥2 segmentos abaixo do drive, e terminando em /<projeto> (pasta alheia nunca termina no seu nome)
  $wtNorm = ([System.IO.Path]::GetFullPath($cfg.wt_root) -replace '\\','/').TrimEnd('/')
  $segs = $wtNorm.Split('/')
  if ($segs.Count -lt 3) { throw "esteira.json: 'wt_root' precisa de pelo menos dois segmentos abaixo do drive, ex. C:/base-wt/<projeto> (recebi '$($cfg.wt_root)')" }
  if ($segs[-1].ToLower() -ne ([string]$cfg.projeto).ToLower()) { throw "esteira.json: 'wt_root' deve terminar em /$($cfg.projeto) (convenção C:/base-wt/<projeto>); recebi '$($cfg.wt_root)'" }
  if ((($cfg.wt_root -replace '\\','/').TrimEnd('/') -split '/').Count -lt 3) { throw "esteira.json: 'wt_root' precisa de pelo menos dois segmentos abaixo do drive, ex. C:/base-wt/<projeto> (recebi '$($cfg.wt_root)')" }
  $vaultDir = [string]($cfg.PSObject.Properties['vault_dir']?.Value ?? '')
  if ($vaultDir -and (($vaultDir -notmatch '^[A-Za-z]:/') -or ((($vaultDir -replace '\\','/').TrimEnd('/') -split '/')[-1].ToLower() -ne ([string]$cfg.projeto).ToLower()))) {
    throw "esteira.json: 'vault_dir' deve ser absoluto e terminar em /$($cfg.projeto) (convenção C:/base-vault/<projeto>); recebi '$vaultDir'"
  }
  # R6 (2026-09-11): "stack" é opcional — ausente = "node" (default do schema). Presente, só {node, python}
  # — dono único desta validação (o lado JS, scripts/lib/stack.mjs, só LÊ o que já foi validado aqui).
  $stackRaw = $cfg.PSObject.Properties['stack']?.Value
  $stack = if ($null -eq $stackRaw -or $stackRaw -eq '') { 'node' } else { [string]$stackRaw }
  if ($stack -notin @('node', 'python')) { throw "esteira.json: 'stack' deve ser 'node' ou 'python' (recebi '$stack')" }

  # "pastas_proibidas" é opcional — array de strings (caminho ABSOLUTO, barras normais). Só o TIPO é
  # validado aqui; não precisa existir no disco (a pasta pode nascer depois). Conteúdo/ancestralidade é
  # responsabilidade de quem grava (bootstrap-projeto.ps1) e de quem aplica (hooks/base-territorio-guard.mjs).
  $pastasProibidasRaw = $cfg.PSObject.Properties['pastas_proibidas']?.Value
  $pastasProibidas = @()
  if ($null -ne $pastasProibidasRaw) {
    if ($pastasProibidasRaw -is [string] -or $pastasProibidasRaw -isnot [System.Collections.IEnumerable]) {
      throw "esteira.json: 'pastas_proibidas' deve ser um array de strings (recebi $($pastasProibidasRaw.GetType().Name))"
    }
    foreach ($p in $pastasProibidasRaw) {
      if ($p -isnot [string]) { throw "esteira.json: 'pastas_proibidas' deve conter só strings (achei $($p.GetType().Name))" }
    }
    $pastasProibidas = @($pastasProibidasRaw | ForEach-Object { [string]$_ })
  }

  $codigoRoot = if ($cfg.codigo -eq '.') { $root } else { Join-Path $root $cfg.codigo }
  $labels = $cfg.PSObject.Properties['labels']?.Value
  $prefixoFrente = if ($labels -and $labels.frente) { $labels.frente } else { 'frente:' }

  [pscustomobject]@{
    Projeto          = $cfg.projeto
    Repo             = $cfg.repo
    Remote           = $cfg.remote
    BranchBase       = $cfg.branch_base
    WtRoot           = $wtNorm
    Codigo           = $cfg.codigo
    Stack            = $stack
    CoordenacaoIssue = [int]$cfg.coordenacao_issue
    NotebookLmId     = [string]($cfg.PSObject.Properties['notebooklm_id']?.Value ?? '')
    VaultDir         = ($vaultDir -replace '\\','/').TrimEnd('/')
    PastasProibidas  = $pastasProibidas
    Labels           = $labels
    PrefixoFrente    = $prefixoFrente
    RepoRoot         = ($root -replace '\\','/')
    CodigoRoot       = ((Resolve-Path $codigoRoot -ErrorAction SilentlyContinue)?.Path ?? $codigoRoot) -replace '\\','/'
    ConfigPath       = ($cfgPath -replace '\\','/')
  }
}

function ConvertTo-Slug {
  <# Normaliza igual em todos os scripts: tira acento (ú->u), minúsculo, [^a-z0-9._-] vira '-',
     colapsa '--' e tira '-' das pontas. "Taxa Pet Dono Único" -> "taxa-pet-dono-unico". #>
  param([Parameter(Mandatory)][string]$Nome)
  $semAcento = [string]::Join('', ($Nome.Normalize([Text.NormalizationForm]::FormD).ToCharArray() |
    Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark }))
  return (($semAcento.Trim().ToLower() -replace '[^a-z0-9._-]', '-') -replace '-{2,}', '-').Trim('-')
}

function Get-FrentePaths {
  <# Caminhos de UMA frente dentro de uma worktree: raiz, pasta do código, registro. #>
  param([Parameter(Mandatory)]$Esteira, [Parameter(Mandatory)][string]$Slug)
  $wt = "$($Esteira.WtRoot)/$Slug"
  $codigo = if ($Esteira.Codigo -eq '.') { $wt } else { "$wt/$($Esteira.Codigo)" }
  [pscustomobject]@{
    Slug        = $Slug
    Branch      = "claude/$Slug"
    Label       = "$($Esteira.PrefixoFrente)$Slug"
    Wt          = $wt
    WtCodigo    = $codigo
    WtGitDir    = "$wt/.git"
    FrentesDir  = "$codigo/governance/active-work/_frentes"
    Registro    = "$codigo/governance/active-work/_frentes/$Slug.md"
  }
}

function Write-Utf8Bom {
  <# Escrita atômica com BOM (o registro nasce e é reescrito sempre com BOM). #>
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Content)
  $tmp = "$Path.tmp"
  [System.IO.File]::WriteAllText($tmp, $Content, (New-Object System.Text.UTF8Encoding($true)))
  Move-Item -Path $tmp -Destination $Path -Force
}
