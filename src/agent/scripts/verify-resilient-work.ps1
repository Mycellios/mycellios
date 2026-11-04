param([switch]$ChecksOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
$taskOutput = Join-Path $taskRoot 'outputs\resilient-work'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskFailures = [Collections.Generic.List[string]]::new()
$taskResults = [Collections.Generic.List[object]]::new()
function Invoke-Stage([string]$Label, [string]$Program, [string[]]$TaskArguments, [string]$Directory = $taskRoot) {
  $taskLog = Join-Path $taskOutput ($Label + '.log')
  $taskStarted = Get-Date
  Push-Location -LiteralPath $Directory
  try {
    & $Program @TaskArguments *> $taskLog
    $taskCode = $LASTEXITCODE
  } finally { Pop-Location }
  $taskResults.Add([pscustomobject]@{ stage=$Label; exitCode=$taskCode; seconds=[math]::Round(((Get-Date)-$taskStarted).TotalSeconds,1); log=$taskLog })
  Write-Output "$Label exit=$taskCode"
  if ($taskCode -ne 0) { $taskFailures.Add($Label); Get-Content -LiteralPath $taskLog -Tail 18 }
}
$taskNode = (Get-Command node).Source
Invoke-Stage 'prisma-generate' $taskNode @('node_modules/prisma/build/index.js','generate','--config','packages/db/prisma.config.ts')
if ($taskFailures.Count) { $taskResults | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $taskOutput 'checks.json'); exit 1 }
foreach ($component in @('adapters','api','worker','desktop','web')) {
  $config = if ($component -eq 'adapters') { 'packages/adapters/tsconfig.json' } else { "apps/$component/tsconfig.json" }
  Invoke-Stage "type-$component" $taskNode @('node_modules/typescript/bin/tsc','--noEmit','-p',$config,'--incremental','--tsBuildInfoFile',"outputs/resilient-work/$component.tsbuildinfo")
}
$taskTests = @(
  'packages/adapters/src/native-command-journal.test.ts',
  'packages/adapters/src/native-command-recovery.test.ts',
  'packages/adapters/src/shell-command-stream.test.ts',
  'packages/adapters/src/work-continuation.test.ts',
  'packages/adapters/src/work-stop-reconciler.test.ts',
  'packages/adapters/src/host-computer.test.ts',
  'packages/adapters/src/host-aware-sandbox.test.ts',
  'packages/adapters/src/host-task-project.test.ts',
  'packages/adapters/src/desktop-process-tree.test.ts',
  'packages/adapters/src/native-agent-runtime.test.ts',
  'packages/adapters/src/pi-runtime.test.ts',
  'packages/adapters/src/pi-runtime-tool-dispatch.test.ts',
  'packages/adapters/src/pi-runtime-cancellation.test.ts',
  'packages/adapters/src/executor-effect-idempotency.test.ts',
  'packages/adapters/src/executor-lazy-computer.test.ts',
  'packages/adapters/src/executor-completion.test.ts',
  'packages/adapters/src/job-reconciler.test.ts',
  'packages/core/src/work-resources.test.ts',
  'packages/core/src/run-state.test.ts',
  'packages/core/src/action-approval.test.ts',
  'apps/api/src/work-controls.test.ts',
  'apps/api/src/task-controls.test.ts',
  'apps/api/src/development-conversations.test.ts',
  'apps/api/src/mico-task-computer.test.ts',
  'apps/api/src/thread-target.test.ts'
  'apps/api/src/connection-account-details.test.ts',
  'packages/adapters/src/composio-identity.test.ts'
)
foreach ($taskTest in $taskTests) { if (!(Test-Path -LiteralPath $taskTest)) { throw "Missing selected test: $taskTest" } }
Invoke-Stage 'affected-tests' $taskNode (@('node_modules/vitest/vitest.mjs','run') + $taskTests + @('--maxWorkers=1'))
Invoke-Stage 'postgres-acceptance' $taskNode @('--import','tsx','scripts/verify-resilient-work-db.ts')
Invoke-Stage 'repository-structure' $taskNode @('scripts/verify-repository-structure.mjs') ([IO.Path]::GetFullPath((Join-Path $taskRoot '../..')))
Invoke-Stage 'documentation' $taskNode @('scripts/verify-documentation.mjs') ([IO.Path]::GetFullPath((Join-Path $taskRoot '../..')))
if (!$ChecksOnly -and !$taskFailures.Count) {
  Invoke-Stage 'build-api' $taskNode @('../../scripts/build-server.mjs','src/index.ts','src/cli/migrate-database.ts','src/cli/bootstrap-owner.ts','src/cli/shared-storage.ts') (Join-Path $taskRoot 'apps/api')
  Invoke-Stage 'build-worker' $taskNode @('../../scripts/build-server.mjs','src/index.ts','src/health-check.ts') (Join-Path $taskRoot 'apps/worker')
  Invoke-Stage 'build-desktop' $taskNode @('scripts/build.mjs') (Join-Path $taskRoot 'apps/desktop')
  Invoke-Stage 'compiled-startup' $taskNode @('scripts/verify-server-startup.mjs')
}
$taskResults | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $taskOutput 'checks.json')
if ($taskFailures.Count) { Write-Output ('Failed: ' + ($taskFailures -join ', ')); exit 1 }
Write-Output 'All selected local stages passed. No production access or deployment.'
exit 0
