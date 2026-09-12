<#
.SYNOPSIS
  Passo 1 da esteira -base: abre uma frente (worktree + branch claude/<slug> + registro).

.DESCRIPTION
  Lê o esteira.json do projeto (subindo a partir da pasta deste script) e cria:
    <cfg.wt_root>/<slug>                       worktree, na branch claude/<slug>, a partir de <remote>/<branch_base>
    <wt>/<cfg.codigo>/governance/active-work/_frentes/<slug>.md   registro da frente (UTF-8 com BOM, escrita atômica)
    <wt>/<cfg.codigo>/node_modules             junction para o node_modules de quem chamou (se existir), para o guard rodar de cara

  RECUSA se já existe a branch, a worktree ou o registro (colisão explícita).
  Idempotente: worktree já existente e saudável -> só diz onde abrir o chat.

  Pode rodar da árvore de integração: aqui ela é a casa do chat de coordenação, e o script
  não commita nada — só fetch + worktree add. O registro nasce SEMPRE na worktree nova.

.EXAMPLE
  npm run frente:abrir -- taxa-pet-dono-unico
#>
param([Parameter(Mandatory = $true)][string]$Frente)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/Esteira.ps1"

$cfg  = Get-Esteira -Start $PSScriptRoot
$slug = ConvertTo-Slug $Frente
if ([string]::IsNullOrWhiteSpace($slug)) { Write-Error 'ERRO: informe um nome de frente. Ex: npm run frente:abrir -- pagamentos'; exit 1 }
$f = Get-FrentePaths -Esteira $cfg -Slug $slug

Write-Host ("projeto {0} · repo {1} · base {2}/{3} · raiz {4}" -f $cfg.Projeto, $cfg.Repo, $cfg.Remote, $cfg.BranchBase, $cfg.WtRoot) -ForegroundColor DarkGray

# ── Enterrar esqueletos de frentes já pousadas (não-fatal) ───────────────────
$varredor = Join-Path $PSScriptRoot 'varrer-worktrees-orfas.ps1'
if (Test-Path $varredor) {
  try { & $varredor -Base $cfg.WtRoot -Quiet } catch { Write-Warning "Varredura de esqueletos falhou (seguindo): $_" }
}

# ── Colisões ANTES de criar qualquer coisa ───────────────────────────────────
git -C $cfg.RepoRoot show-ref --verify --quiet "refs/heads/$($f.Branch)" 2>$null
$branchExists = ($LASTEXITCODE -eq 0)

$wtExists = $false
foreach ($linha in @(git -C $cfg.RepoRoot worktree list --porcelain 2>$null)) {
  if ($linha -like 'worktree *') {
    $p = ($linha.Substring(9).Trim() -replace '\\','/').TrimEnd('/')
    if ($p -ieq $f.Wt) { $wtExists = $true; break }
  }
}
$registroExists = Test-Path $f.Registro

if ($wtExists) {
  Write-Host ("OK: worktree já existe -> {0}  (branch {1})" -f $f.Wt, $f.Branch) -ForegroundColor Green
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host '  ABRA SEU CHAT CLAUDE NESTA PASTA (não na árvore de integração):' -ForegroundColor Cyan
  Write-Host ("     {0}" -f $f.Wt) -ForegroundColor Yellow
  Write-Host '==============================================================' -ForegroundColor Cyan
  exit 0
}
if ($branchExists -or $registroExists) {
  $msg = "ERRO: colisão para a frente '$slug':"
  if ($branchExists)   { $msg += "`n  - branch '$($f.Branch)' já existe localmente" }
  if ($registroExists) { $msg += "`n  - registro '$($f.Registro)' já existe" }
  $msg += "`n`nFrente abandonada? Apague a branch e o registro antes de reabrir. Outra sessão com o mesmo nome? Escolha outro slug."
  Write-Error $msg; exit 1
}

# ── Quem está abrindo (dono inicial, herdado; fail-soft) ─────────────────────
# O hook de SessionStart da família grava <git-dir>/claude-session-id. Se quem chama tem um,
# a frente nasce com dono; senão nasce vazia e o chat novo preenche ao abrir na worktree.
$chatIdInicial = ''
try {
  $gitDir = (git -C $cfg.RepoRoot rev-parse --absolute-git-dir 2>$null)
  if ($gitDir) {
    $idFile = Join-Path ($gitDir.Trim()) 'claude-session-id'
    if (Test-Path $idFile) {
      $bruto = (Get-Content -Raw -Path $idFile).Trim()
      if ($bruto -match '^[A-Za-z0-9._-]{1,128}$') { $chatIdInicial = $bruto }
    }
  }
} catch { }

# ── Reconhecer o terreno (informa, não bloqueia) ─────────────────────────────
Write-Host ''
try { Push-Location $cfg.CodigoRoot; npm run --silent frentes:panorama -- --curto; Pop-Location }
catch { Pop-Location -ErrorAction SilentlyContinue; Write-Host '[panorama] indisponível — seguindo sem ele.' -ForegroundColor DarkYellow }
Write-Host ''

# ── Criar worktree ───────────────────────────────────────────────────────────
if (-not (Test-Path $cfg.WtRoot)) { New-Item -ItemType Directory -Force -Path $cfg.WtRoot | Out-Null }

Write-Host ("Atualizando {0}/{1} antes de ramificar..." -f $cfg.Remote, $cfg.BranchBase) -ForegroundColor Gray
git -C $cfg.RepoRoot fetch $cfg.Remote $cfg.BranchBase --quiet
if ($LASTEXITCODE -ne 0) { Write-Error "ERRO: git fetch $($cfg.Remote) $($cfg.BranchBase) falhou. O remote existe? (git remote -v)"; exit 1 }

git -C $cfg.RepoRoot worktree add $f.Wt -b $f.Branch ("{0}/{1}" -f $cfg.Remote, $cfg.BranchBase)
if ($LASTEXITCODE -ne 0) { Write-Error 'ERRO: falha ao criar a worktree. Rode `git worktree list` e verifique.'; exit 1 }
Write-Host ("CRIADA: worktree -> {0}  (branch {1})" -f $f.Wt, $f.Branch) -ForegroundColor Green

# ── Registro da frente — SEMPRE na worktree nova ─────────────────────────────
if (-not (Test-Path $f.FrentesDir)) { New-Item -ItemType Directory -Force -Path $f.FrentesDir | Out-Null }
$now = (Get-Date).ToString('o')
$registro = @"
---
projeto: $($cfg.Projeto)
slug: $slug
branch: $($f.Branch)
worktree_path: $($f.WtCodigo)
worktree_gitdir: $($f.WtGitDir)
chat_id: "$chatIdInicial"
app_session_id: ""
session_title: ""
status: aberta
opened_at: $now
last_seen: $now
pr: ""
github_frente: ""
closed_at: ""
---
Frente aberta via ``npm run frente:abrir`` em $now.
"@
try { Write-Utf8Bom -Path $f.Registro -Content $registro; Write-Host ("REGISTRO: {0}" -f $f.Registro) -ForegroundColor Green }
catch { Write-Warning "Não foi possível gravar o registro da frente: $_" }

# ── node_modules por junction (best-effort) ──────────────────────────────────
$nmOrigem  = Join-Path $cfg.CodigoRoot 'node_modules'
$nmDestino = Join-Path $f.WtCodigo 'node_modules'
if ((Test-Path (Join-Path $f.WtCodigo 'package.json')) -and (Test-Path $nmOrigem) -and -not (Test-Path $nmDestino)) {
  try { New-Item -ItemType Junction -Path $nmDestino -Target $nmOrigem | Out-Null; Write-Host "NODE_MODULES: junction -> $nmOrigem" -ForegroundColor Green }
  catch { Write-Warning "Não criei a junction de node_modules (rode npm install na worktree): $_" }
}

# ── Mensagem final ───────────────────────────────────────────────────────────
Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host '  ABRA SEU CHAT CLAUDE NESTA PASTA (não na árvore de integração):' -ForegroundColor Cyan
Write-Host ("     {0}" -f $f.Wt) -ForegroundColor Yellow
Write-Host '  e rode /ligar-frente-base como PRIMEIRO comando.' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Regras desta frente:' -ForegroundColor Gray
Write-Host ("  - commite SÓ na branch {0}" -f $f.Branch) -ForegroundColor Gray
Write-Host ("  - nunca commite na árvore de integração nem na branch {0}" -f $cfg.BranchBase) -ForegroundColor Gray
Write-Host ("  - para enviar:  git push {0} {1}" -f $cfg.Remote, $f.Branch) -ForegroundColor Gray
Write-Host '  - ao terminar:  npm run frente:fechar' -ForegroundColor Gray
Write-Host ''
try { Start-Process explorer.exe $f.Wt | Out-Null } catch { }
