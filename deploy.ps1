# IT Leads CRM — GitHub Pages Deployer (PowerShell)
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IT Leads CRM — GitHub Pages Deployer" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Git not installed. Download: https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}

$ghUser   = Read-Host "GitHub username"
$repoName = Read-Host "Repo name (press Enter for 'leads-crm')"
if ([string]::IsNullOrWhiteSpace($repoName)) { $repoName = "leads-crm" }

$remote = "https://github.com/$ghUser/$repoName.git"
Write-Host "`nDeploying to: $remote`n" -ForegroundColor Yellow

# Init if needed
if (-not (Test-Path ".git")) {
    git init
    Write-Host "Git repo initialized." -ForegroundColor Green
}

git add crm.html
git commit -m "Deploy IT Leads CRM - $(Get-Date -Format 'yyyy-MM-dd')"
git branch -M main
git remote add origin $remote 2>$null
git remote set-url origin $remote
git push -u origin main

Write-Host "`n============================================" -ForegroundColor Green
Write-Host "DONE! Enable GitHub Pages:" -ForegroundColor Green
Write-Host "  https://github.com/$ghUser/$repoName/settings/pages" -ForegroundColor Cyan
Write-Host "  Source: main branch / root → Save" -ForegroundColor White
Write-Host "`nYour CRM will be live at:" -ForegroundColor Green
Write-Host "  https://$ghUser.github.io/$repoName/crm.html" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Green
