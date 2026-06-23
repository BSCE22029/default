@echo off
echo ============================================
echo   IT Leads CRM — GitHub Pages Deployer
echo ============================================
echo.

:: Check if git is installed
where git >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Git is not installed.
  echo Download from: https://git-scm.com/download/win
  pause
  exit /b 1
)

:: Ask for GitHub username
set /p GHUSER=Enter your GitHub username:
set /p REPONAME=Enter repo name (default: leads-crm):
if "%REPONAME%"=="" set REPONAME=leads-crm

set REMOTE=https://github.com/%GHUSER%/%REPONAME%.git

echo.
echo Deploying to: %REMOTE%
echo.

:: Init git if not already a repo
if not exist ".git" (
  echo Initializing git repository...
  git init
)

:: Stage only the CRM file
git add crm.html

:: Commit
git commit -m "Deploy IT Leads CRM - %date%"

:: Set branch to main
git branch -M main

:: Add remote (ignore error if already exists)
git remote add origin %REMOTE% 2>nul
git remote set-url origin %REMOTE%

:: Push
echo.
echo Pushing to GitHub...
git push -u origin main

echo.
echo ============================================
echo DONE! Now enable GitHub Pages:
echo  1. Go to: https://github.com/%GHUSER%/%REPONAME%/settings/pages
echo  2. Source: Deploy from branch → main → / (root)
echo  3. Save
echo.
echo Your CRM will be live at:
echo  https://%GHUSER%.github.io/%REPONAME%/crm.html
echo ============================================
pause
