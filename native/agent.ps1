param([Parameter(Mandatory=$true)][int]$ParentProcessId, [switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path (Join-Path $PSScriptRoot 'PetWindowAgent.cs')
if ($Probe) { [PetWindowAgent]::Probe(); exit 0 }
[PetWindowAgent]::Run($ParentProcessId)
