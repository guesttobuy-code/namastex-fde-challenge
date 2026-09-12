<#
.SYNOPSIS
  Varre <cfg.wt_root> e apaga ESQUELETOS de worktrees já pousadas (pastas sem arquivo que o git não registra).

.DESCRIPTION
  Existe por um limite do Windows: um processo com cwd dentro de uma pasta trava a pasta e todos
  os pais. O fechar-frente roda de DENTRO da frente, então o git desregistra e apaga os arquivos,
  mas as pastas vazias sobram. Quem enterra é o próximo abrir/fechar, que roda de FORA.

  ESTE SCRIPT APAGA. Duas guardas:
    1. Confirmação POSITIVA: só age se `git worktree list` rodou com sucesso. Falha BLOQUEIA, nunca libera.
    2. Alvo estreito: só apaga pasta que o git NÃO registra E tem ZERO arquivos. Qualquer conteúdo é preservado.

.PARAMETER Base      Pasta das worktrees. Default: wt_root do esteira.json.
.PARAMETER RepoPath  Repositório a consultar. Default: RepoRoot do esteira.json.
.PARAMETER Quiet     Só fala quando apaga alguma coisa.
#>
param([string]$Base = '', [string]$RepoPath = '', [switch]$Quiet)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/Esteira.ps1"

if (-not $Base -or -not $RepoPath) {
  $cfg = Get-Esteira -Start $PSScriptRoot
  if (-not $Base)     { $Base = $cfg.WtRoot }
  if (-not $RepoPath) { $RepoPath = $cfg.RepoRoot }
}
function Write-Passo($msg, $cor) { if (-not $Quiet) { Write-Host $msg -ForegroundColor $cor } }

if (-not (Test-Path $Base)) { Write-Passo "Nada a varrer: $Base não existe." 'Gray'; exit 0 }

$lista = @(git -C $RepoPath worktree list --porcelain 2>$null)
if ($LASTEXITCODE -ne 0 -or $lista.Count -eq 0) {
  Write-Warning "varrer-worktrees-orfas: não consegui listar as worktrees do git. Nada foi apagado."
  exit 0
}
$registradas = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($linha in $lista) {
  if ($linha -like 'worktree *') { [void]$registradas.Add((($linha.Substring(9).Trim() -replace '\\','/').TrimEnd('/')).ToLower()) }
}

$apagadas = @(); $preservadas = @()
foreach ($dir in (Get-ChildItem $Base -Directory -Force -ErrorAction SilentlyContinue)) {
  $path = ($dir.FullName -replace '\\','/').TrimEnd('/')
  if ($registradas.Contains($path.ToLower())) { continue }
  # issue #14: só pasta com NOME DE SLUG de frente é candidata; `_*` (réplica) e qualquer outra coisa ficam em paz
  if ($dir.Name -notmatch '^[a-z0-9][a-z0-9._-]*$') { continue }
  $arquivos = @(Get-ChildItem $dir.FullName -Recurse -Force -File -ErrorAction SilentlyContinue)
  if ($arquivos.Count -gt 0) { $preservadas += [pscustomobject]@{ Path = $path; Arquivos = $arquivos.Count }; continue }
  Remove-Item -Recurse -Force $dir.FullName -ErrorAction SilentlyContinue
  if (-not (Test-Path $dir.FullName)) { $apagadas += $path } else { $preservadas += [pscustomobject]@{ Path = $path; Arquivos = 0 } }
}

foreach ($p in $apagadas) { Write-Host "VARRIDO: esqueleto vazio de worktree já pousada -> $p" -ForegroundColor Gray }
foreach ($p in $preservadas) {
  if ($p.Arquivos -gt 0) { Write-Warning "PRESERVADO: $($p.Path) tem $($p.Arquivos) arquivo(s) e não está no git. Confira antes de apagar à mão." }
  else { Write-Passo "PENDENTE: $($p.Path) está vazio mas travado por algum terminal. A próxima varredura pega." 'Yellow' }
}
if (-not $Quiet -and $apagadas.Count -eq 0 -and $preservadas.Count -eq 0) { Write-Host 'Nada a varrer: disco e git batem.' -ForegroundColor Green }
exit 0
