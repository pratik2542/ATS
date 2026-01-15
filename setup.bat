@echo off
REM ATS Resume Tracker - Quick Setup Script for Windows

echo 🚀 Setting up ATS Resume Tracker...

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    echo    Visit: https://nodejs.org/
    exit /b 1
)

echo ✓ Node.js found
node --version

REM Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm is not installed. Please install npm first.
    exit /b 1
)

echo ✓ npm found
npm --version

REM Install dependencies
echo.
echo 📦 Installing dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Failed to install dependencies
    exit /b 1
)

echo ✓ Dependencies installed successfully

REM Build the extension
echo.
echo 🔨 Building extension...
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Build failed
    exit /b 1
)

echo ✓ Build completed successfully

REM Create placeholder icons if they don't exist
echo.
echo 🎨 Creating icons folder...
if not exist "public\icons" mkdir "public\icons"

REM Instructions
echo.
echo ✅ Setup complete!
echo.
echo 📋 Next steps:
echo    1. Add your own icons to public\icons\ folder:
echo       - icon16.png (16x16)
echo       - icon48.png (48x48)
echo       - icon128.png (128x128)
echo.
echo    2. Load the extension in Chrome:
echo       - Open chrome://extensions/
echo       - Enable 'Developer mode'
echo       - Click 'Load unpacked'
echo       - Select the 'dist' folder
echo.
echo    3. Configure your OpenAI API key in the extension settings
echo.
echo    4. Start using ATS Resume Tracker!
echo.
echo 💡 Tip: Get your OpenAI API key at https://platform.openai.com/api-keys
echo.

pause
