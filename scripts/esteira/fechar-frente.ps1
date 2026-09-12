<#
.SYNOPSIS
  Pouso da frente atual (motor do /pousar-frente-base). Sem -Status roda em CONFERÊNCIA e não fecha nada.

.DESCRIPTION
  Roda de DENTRO da worktree da frente. Confere working tree, stashes e PR; com -Status grava o
  estado terminal no registro e, se `mergeado` ou `abandonado-com-backup`, arquiva o registro em
  <pai de wt_root>/_arquivo/<projeto>/frentes-registros/ e remove a worktree.

  Estados terminais: mergeado · pr-aberto-ci-verde · handoff · abandonado-com-backup.
  Escolher o estado por você seria chute — por isso -Status é explícito.

.EXAMPLE
  npm run frente:fechar                       # conferência
  npm run frente:fechar -- -Status mergeado   # pousa
#>
param(
  [ValidateSet('mergeado','pr-aberto-ci-verde','handoff','abandonado-com-backup')][string]$Status,
  [switch]$Check
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/Esteira.ps1"

if (-not $Check -and -not $Status) {
  $Check = $true
  Write-Host 'Sem -Status: modo CONFERÊNCIA. NADA será fechado.' -ForegroundColor Yellow
  Write-Host 'Para POUSAR, repita com o estado terminal:' -ForegroundColor Gray
  foreach ($s in 'mergeado','pr-aberto-ci-verde','handoff','abandonado-com-backup') { Write-Host "  npm run frente:fechar -- -Status $s" -ForegroundColor Gray }
  Write-Host ''
}

$cfg = Get-Esteira -Start $PSScriptRoot
$branch = (git -C $cfg.RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch -or -not $branch.Trim().StartsWith('claude/')) { Write-Error "ERRO: a branch atual não é frente Claude: '$branch'. Rode de dentro da worktree da frente."; exit 1 }
$branch = $branch.Trim(); $slug = $branch.Substring(7)
$wtPath = $cfg.RepoRoot
if (-not $wtPath.ToLower().StartsWith($cfg.WtRoot.ToLower())) { Write-Error "ERRO: '$wtPath' não está sob wt_root ($($cfg.WtRoot)). Isto é a árvore de integração? Não se pousa daqui."; exit 1 }

# esqueletos de pousos anteriores (não-fatal) — roda antes, enquanto esta frente ainda está registrada
$varredor = Join-Path $PSScriptRoot 'varrer-worktrees-orfas.ps1'
if (Test-Path $varredor) { try { & $varredor -Base $cfg.WtRoot -RepoPath $cfg.RepoRoot -Quiet } catch { Write-Warning "Varredura falhou (seguindo): $_" } }

$frentesDir = "$($cfg.CodigoRoot)/governance/active-work/_frentes"
$registro   = "$frentesDir/$slug.md"
if (-not (Test-Path $registro)) { Write-Warning "Registro não encontrado: $registro"; if ($Check) { exit 1 } }

# ── Medir ────────────────────────────────────────────────────────────────────
$sujos = @(git -C $wtPath status --porcelain 2>$null | Where-Object { $_ -and $_.Trim() })
$isDirty = $sujos.Count -gt 0
$stashCount = @(git -C $wtPath stash list 2>$null | Where-Object { $_ }).Count
$prUrl = ''; $hasPrOpen = $false
try {
  $gh = (gh pr list --repo $cfg.Repo --head $branch --state open --json url 2>$null) | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($gh -and @($gh).Count -gt 0) { $hasPrOpen = $true; $prUrl = @($gh)[0].url }
} catch { }
$registeredPr = ''; $registeredStatus = ''; $fc = ''
if (Test-Path $registro) {
  $fc = Get-Content $registro -Raw
  if ($fc -match '(?m)^pr:\s*"([^"]+)"')     { $registeredPr = $Matches[1].Trim(); $hasPrOpen = $true }
  if ($fc -match '(?m)^status:\s*([a-z-]+)') { $registeredStatus = $Matches[1].Trim() }
}
$isHandoff = ($registeredStatus -eq 'handoff')

# saúde dos guards do projeto, se ele tiver o script (não bloqueia — guard mudo é o que custou 6 semanas na esteira de origem)
function Invoke-ConferenciaGuards {
  $pkg = Join-Path $cfg.CodigoRoot 'package.json'
  if (-not (Test-Path $pkg)) { return }
  $pkgObj = Get-Content $pkg -Raw | ConvertFrom-Json
  $scripts = $pkgObj.PSObject.Properties['scripts']?.Value
  if (-not $scripts -or -not $scripts.PSObject.Properties['guards:health']) { return }
  Write-Host "`n--- Conferência de saúde dos guards ---" -ForegroundColor Cyan
  Push-Location $cfg.CodigoRoot
  try { npm run --silent guards:health; if ($LASTEXITCODE -ne 0) { Write-Host '[AVISO] Guards com critério crítico reprovado. Não bloqueia o pouso, mas CONSERTE.' -ForegroundColor Yellow } }
  catch { Write-Host "[AVISO] Conferência de guards não rodou: $_" -ForegroundColor Yellow }
  finally { Pop-Location }
}

# ── Conferência ──────────────────────────────────────────────────────────────
if ($Check) {
  $ready = $true
  Write-Host "=== fechar-frente -Check: $slug ===" -ForegroundColor Cyan
  Write-Host "  Branch: $branch | Status: $registeredStatus | PR: $hasPrOpen $prUrl" -ForegroundColor Gray
  Write-Host ''
  if ($isDirty -and -not $hasPrOpen -and -not $isHandoff) { Write-Host "[FALHA] Working tree sujo ($($sujos.Count) arquivo(s)) sem PR/handoff." -ForegroundColor Red; $sujos | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }; $ready = $false }
  elseif ($isDirty) { Write-Host "[AVISO] Sujo ($($sujos.Count)) mas PR/handoff ok." -ForegroundColor Yellow }
  else { Write-Host '[OK] Working tree limpo.' -ForegroundColor Green }
  if ($stashCount -gt 0) { Write-Host "[FALHA] $stashCount stash(es)." -ForegroundColor Red; $ready = $false } else { Write-Host '[OK] Sem stashes.' -ForegroundColor Green }
  Invoke-ConferenciaGuards
  Write-Host ''
  if ($ready) { Write-Host 'PRONTO.' -ForegroundColor Green; exit 0 } else { Write-Host 'NÃO pronto.' -ForegroundColor Red; exit 1 }
}

# ── Pouso ────────────────────────────────────────────────────────────────────
$bloqueios = @()
if ($isDirty -and -not $hasPrOpen -and -not $isHandoff) { $bloqueios += "working tree sujo ($($sujos.Count) arquivo(s)) sem PR/handoff" }
if ($stashCount -gt 0) { $bloqueios += "$stashCount stash(es)" }
if ($bloqueios.Count -gt 0) { Write-Error ("Não pode fechar: " + ($bloqueios -join ' | ')); exit 1 }
Invoke-ConferenciaGuards

$now = (Get-Date).ToString('o')
$snapshot = ''
if (Test-Path $registro) {
  $fc = $fc -replace '(?m)^status:\s*[a-z-]+', "status: $Status"
  $fc = $fc -replace '(?m)^last_seen:\s*\S+', "last_seen: $now"
  $fc = $fc -replace '(?m)^closed_at:\s*""', "closed_at: $now"
  if ($prUrl -and -not $registeredPr) { $fc = $fc -replace '(?m)^pr:\s*""', "pr: `"$prUrl`"" }
  try { Write-Utf8Bom -Path $registro -Content $fc; Write-Host "REGISTRO ATUALIZADO: status=$Status" -ForegroundColor Green } catch { Write-Warning "Falha ao atualizar o registro: $_" }
  $snapshot = $fc
}

if ($Status -in 'mergeado','abandonado-com-backup') {
  # arquivar ANTES de remover: o registro morre com a worktree
  if ($snapshot) {
    $arquivoDir = "$(Split-Path $cfg.WtRoot -Parent)/_arquivo/$($cfg.Projeto)/frentes-registros"
    New-Item -ItemType Directory -Force $arquivoDir | Out-Null
    try { Write-Utf8Bom -Path "$arquivoDir/$slug.md" -Content $snapshot; Write-Host "REGISTRO ARQUIVADO: $arquivoDir/$slug.md" -ForegroundColor Gray } catch { Write-Warning "Não arquivei o registro: $_" }
  }

  # --force só quando o ÚNICO sujo é o registro que este script acabou de escrever
  $sujosAgora = @(git -C $wtPath status --porcelain 2>$null | Where-Object { $_ -and $_.Trim() })
  $soRegistro = ($sujosAgora.Count -eq 1 -and $sujosAgora[0] -like "*_frentes/$slug.md")

  # repo principal = primeira entrada do porcelain (path intacto mesmo com espaços)
  $repoPrincipal = $null
  foreach ($l in @(git -C $wtPath worktree list --porcelain 2>$null)) { if ($l -like 'worktree *') { $repoPrincipal = $l.Substring(9).Trim(); break } }
  if (-not $repoPrincipal) { Write-Error "ERRO: não identifiquei o repositório principal a partir de $wtPath. Nada removido."; exit 1 }

  # sair da worktree antes de removê-la (Windows trava cwd), falando com o principal por -C
  $refugio = [System.IO.Path]::GetTempPath()
  Push-Location $refugio
  Write-Host "Removendo worktree: $wtPath  (via $repoPrincipal)" -ForegroundColor Gray
  if ($soRegistro) { git -C $repoPrincipal worktree remove --force $wtPath } else { git -C $repoPrincipal worktree remove $wtPath }

  # guarda de destruição exige confirmação POSITIVA: verificação que falha BLOQUEIA
  $aindaRegistrada = $false; $listaOk = $false
  if (Test-Path $wtPath) {
    $lista = @(git -C $repoPrincipal worktree list --porcelain 2>$null); $listaOk = ($LASTEXITCODE -eq 0)
    foreach ($l in $lista) { if ($l -like 'worktree *' -and ((($l.Substring(9).Trim() -replace '\\','/').TrimEnd('/')) -ieq $wtPath.TrimEnd('/'))) { $aindaRegistrada = $true; break } }
    if (-not $listaOk)        { Write-Warning '  (não confirmei com o git o estado da worktree — NÃO apago nada)' }
    elseif ($aindaRegistrada) { Write-Warning '  (o git ainda registra esta worktree — NÃO apago nada)' }
    else { Write-Host '  (git desregistrou mas não apagou — limpando órfão)' -ForegroundColor Gray; Remove-Item -Recurse -Force $wtPath -ErrorAction SilentlyContinue }
  }
  try { Pop-Location } catch { Set-Location $refugio }

  $sobrou = 0
  if (Test-Path $wtPath) { $sobrou = @(Get-ChildItem $wtPath -Recurse -Force -File -ErrorAction SilentlyContinue).Count }
  if (-not (Test-Path $wtPath)) { Write-Host 'WORKTREE REMOVIDA.' -ForegroundColor Green }
  elseif ($sobrou -eq 0 -and -not $aindaRegistrada) {
    Write-Host 'WORKTREE REMOVIDA (git desregistrou, arquivos apagados).' -ForegroundColor Green
    Write-Host "  Sobrou esqueleto de pastas VAZIAS em $wtPath — seu terminal ainda está dentro. A próxima frente que abrir ou fechar varre." -ForegroundColor Yellow
  } else { Write-Error "ERRO: remoção falhou ($sobrou arquivo(s) no disco, registrada no git: $aindaRegistrada). Sujos: $($sujosAgora -join '; ')"; exit 1 }
}

Write-Host "=== Frente $slug fechada: $Status ===" -ForegroundColor Cyan
switch ($Status) {
  'mergeado'              { Write-Host 'Worktree removida.' -ForegroundColor Green }
  'pr-aberto-ci-verde'    { Write-Host ("Aguardando merge do dono. {0}" -f $prUrl) -ForegroundColor Yellow }
  'handoff'               { Write-Host 'Handoff registrado.' -ForegroundColor Yellow }
  'abandonado-com-backup' { Write-Host 'Branch pushada. Worktree removida.' -ForegroundColor Yellow }
}
Write-Host ''
