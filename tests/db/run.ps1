<#
.SYNOPSIS
  Applies the B1 migrations to a throwaway postgres:17 container, then runs
  every SQL assertion file in tests/db in order.

.DESCRIPTION
  The container is created and destroyed by this script; nothing here touches a
  remote Supabase project. The auth schema is a local shim (00_auth_shim.sql),
  so these are tests against shimmed PostgreSQL, NOT against real Supabase Auth.
  See tests/db/README.md.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tests\db\run.ps1
#>
param(
  [string]$Image = 'postgres:17',
  [string]$Container = 'crm-b1-tests',
  [int]$Port = 55433
)

$db     = Join-Path $PSScriptRoot '..\..'
$tests  = $PSScriptRoot
$failed = $false

# PS 5.1 turns native-command stderr into terminating errors under
# $ErrorActionPreference = 'Stop', and `docker rm -f` on a missing container
# always writes to stderr. Run docker through this wrapper instead.
function Invoke-Docker {
  param([string[]]$ArgList)
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & docker @ArgList 2>&1
    return [pscustomobject]@{ Output = @($out | ForEach-Object { "$_" }); ExitCode = $LASTEXITCODE }
  }
  finally { $ErrorActionPreference = $eap }
}

function Step {
  param([string]$Label)
  Write-Host "==> $Label"
}

# Run one SQL file inside the container. Any psql error fails the run.
function Invoke-File {
  param([string]$File, [string]$Label)
  $r = Invoke-Docker @('exec', '-i', $Container, 'psql', '-v', 'ON_ERROR_STOP=1', '-q',
                        '-U', 'postgres', '-d', 'postgres', '-f', "/tmp/tests/$File")
  foreach ($line in $r.Output) { Write-Host "   $line" }
  if ($r.ExitCode -ne 0) {
    Write-Host "   !! FAILED: $Label (psql exit $($r.ExitCode))" -ForegroundColor Red
    $script:failed = $true
    return $false
  }
  return $true
}

Step "container $Container ($Image) on port $Port"
Invoke-Docker @('rm', '-f', $Container) | Out-Null
$r = Invoke-Docker @('run', '-d', '--name', $Container,
                      '-e', 'POSTGRES_PASSWORD=postgres', '-p', "${Port}:5432", $Image)
if ($r.ExitCode -ne 0) { throw "could not start container: $($r.Output -join "`n")" }

try {
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    if ((Invoke-Docker @('exec', $Container, 'pg_isready', '-U', 'postgres', '-q')).ExitCode -eq 0) {
      $ready = $true; break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'postgres never became ready' }

  Step 'copying files'
  Invoke-Docker @('exec', $Container, 'mkdir', '-p', '/tmp/tests') | Out-Null
  $copies = @(
    @{ src = (Join-Path $tests '00_auth_shim.sql');                              dst = '00_auth_shim.sql' },
    @{ src = (Join-Path $db 'supabase\migrations\20261022120000_b1_schema.sql');  dst = '10-b1_schema.sql' },
    @{ src = (Join-Path $db 'supabase\migrations\20261022130000_b1_security_remediation.sql'); dst = '20-remediation.sql' },
    @{ src = (Join-Path $db 'supabase\migrations\20261024100000_b1_uniqueness_trim.sql'); dst = '30-uniqueness_trim.sql' },
    @{ src = (Join-Path $db 'supabase\migrations\20261026120000_b2_schema_parity.sql'); dst = '40-b2_schema_parity.sql' }
  )
  Get-ChildItem $tests -Filter '*.sql' |
    Where-Object { $_.Name -ne '00_auth_shim.sql' } |
    ForEach-Object { $copies += @{ src = $_.FullName; dst = $_.Name } }
  foreach ($c in $copies) {
    $r = Invoke-Docker @('cp', $c.src, "${Container}:/tmp/tests/$($c.dst)")
    if ($r.ExitCode -ne 0) { throw "docker cp failed for $($c.src): $($r.Output -join "`n")" }
  }

  Step 'auth shim (local-only, not part of the repo migrations)'
  if (-not (Invoke-File '00_auth_shim.sql' 'auth shim')) { throw 'shim failed' }

  Step 'migration 20261022120000_b1_schema.sql'
  if (-not (Invoke-File '10-b1_schema.sql' 'b1_schema')) { throw 'b1_schema failed' }

  Step 'migration 20261022130000_b1_security_remediation.sql'
  if (-not (Invoke-File '20-remediation.sql' 'b1_security_remediation')) { throw 'remediation failed' }

  Step 'migration 20261024100000_b1_uniqueness_trim.sql'
  if (-not (Invoke-File '30-uniqueness_trim.sql' 'b1_uniqueness_trim')) { throw 'uniqueness_trim failed' }

  Step 'migration 20261026120000_b2_schema_parity.sql'
  if (-not (Invoke-File '40-b2_schema_parity.sql' 'b2_schema_parity')) { throw 'b2_schema_parity failed' }

  $ordered = @(
    '10_setup.sql',
    '20_bootstrap_and_signup_security.sql',
    '30_rls_isolation.sql',
    '41_viewer_cannot_write.sql',
    '42_admin_cannot_mint_owner.sql',
    '43_admin_cannot_self_promote.sql',
    '44_score_events_not_client_writable.sql',
    '45_score_events_immutable.sql',
    '50_writes_and_history.sql',
    '60_cross_workspace_ownership.sql',
    '70_last_owner_guard.sql',
    '80_score_attribution.sql',
    '90_import_counters.sql',
    '95_uniqueness_trim.sql'
  )
  # 42-45 are negative tests: the statement MUST be rejected, so a non-zero
  # psql exit is the passing outcome. Their trailing \echo UNREACHABLE must not
  # appear in the output.
  $mustFail = @(
    '42_admin_cannot_mint_owner.sql',
    '43_admin_cannot_self_promote.sql',
    '44_score_events_not_client_writable.sql',
    '45_score_events_immutable.sql'
  )
  foreach ($f in $ordered) {
    Step $f
    if ($mustFail -contains $f) {
      $r = Invoke-Docker @('exec', '-i', $Container, 'psql', '-v', 'ON_ERROR_STOP=1', '-q',
                            '-U', 'postgres', '-d', 'postgres', '-f', "/tmp/tests/$f")
      foreach ($line in $r.Output) { Write-Host "   $line" }
      if ($r.ExitCode -eq 0) {
        Write-Host "   !! FAILED: $f was NOT rejected" -ForegroundColor Red
        $failed = $true; break
      }
      if ($r.Output -match 'UNREACHABLE') {
        Write-Host "   !! FAILED: $f ran past the rejection" -ForegroundColor Red
        $failed = $true; break
      }
      Write-Host '   PASS rejected as expected'
    }
    elseif (-not (Invoke-File $f $f)) { break }
  }

  if (-not $failed) {
    # ---- concurrency: two transactions each deleting one of two owners ----
    Step '71_owner_concurrency_setup.sql'
    if (Invoke-File '71_owner_concurrency_setup.sql' 'concurrency setup') {

      Step 'racing two concurrent owner deletions'
      $race = {
        param($c, $victim)
        $ErrorActionPreference = 'Continue'
        # 2>&1 so the guard's rejection (written to stderr) is captured as text.
        $out = & docker exec $c psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres -c @"
begin;
delete from public.workspace_members
  where user_id = '$victim'
    and workspace_id = (
      select w.id from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id
      where m.user_id = 'eeeeeeee-0000-4000-8000-000000000030' and m.role = 'owner');
select pg_sleep(1.5);
commit;
"@ 2>&1
        @($out | ForEach-Object { "$_" })
      }
      $a = Start-Job -ScriptBlock $race -ArgumentList $Container, 'eeeeeeee-0000-4000-8000-000000000030'
      Start-Sleep -Milliseconds 400
      $b = Start-Job -ScriptBlock $race -ArgumentList $Container, 'eeeeeeee-0000-4000-8000-000000000031'
      $ra = @(Wait-Job $a | Receive-Job | ForEach-Object { "$_" })
      $rb = @(Wait-Job $b | Receive-Job | ForEach-Object { "$_" })
      Remove-Job $a, $b -Force
      $refused = @($ra + $rb | Where-Object { $_ -match 'without an owner' }).Count
      foreach ($line in ($ra + $rb)) { if ($line) { Write-Host "   $line" } }

      Step '71_owner_concurrency_assert.sql'
      if (Invoke-File '71_owner_concurrency_assert.sql' 'concurrency assert') {
        Write-Host "==> transactions refused by the guard: $refused (expected 1)"
        if ($refused -ne 1) {
          Write-Host '   !! FAILED: expected exactly one transaction to be refused' -ForegroundColor Red
          $failed = $true
        }
      }
    }
  }
}
finally {
  Invoke-Docker @('rm', '-f', $Container) | Out-Null
}

if ($failed) { Write-Host "`nTESTS FAILED" -ForegroundColor Red; exit 1 }
Write-Host "`nALL TESTS PASSED"; exit 0
