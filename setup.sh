#!/bin/bash

# ATS Resume Tracker - Quick Setup Script

echo "🚀 Setting up ATS Resume Tracker..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js found: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✓ npm found: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✓ Dependencies installed successfully"

# Build the extension
echo ""
echo "🔨 Building extension..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✓ Build completed successfully"

# Create placeholder icons if they don't exist
echo ""
echo "🎨 Creating placeholder icons..."
mkdir -p public/icons

# Instructions
echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Add your own icons to public/icons/ folder:"
echo "      - icon16.png (16x16)"
echo "      - icon48.png (48x48)"
echo "      - icon128.png (128x128)"
echo ""
echo "   2. Load the extension in Chrome:"
echo "      - Open chrome://extensions/"
echo "      - Enable 'Developer mode'"
echo "      - Click 'Load unpacked'"
echo "      - Select the 'dist' folder"
echo ""
echo "   3. Configure your OpenAI API key in the extension settings"
echo ""
echo "   4. Start using ATS Resume Tracker!"
echo ""
echo "💡 Tip: Get your OpenAI API key at https://platform.openai.com/api-keys"
echo ""
