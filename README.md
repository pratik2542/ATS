# 🎯 ATS Resume Tracker

AI-powered Chrome extension to track job applications, optimize resumes, and generate ATS-friendly cover letters. Never lose track of your job hunt again!

## ✨ Features

- 📄 **AI Resume Optimization** - Automatically tailor your resume to match job descriptions
- 📝 **Cover Letter Generator** - Create personalized cover letters with AI
- 📊 **Application Tracker** - Track all your job applications in one place
- 🎯 **ATS Score Analysis** - See how well your resume matches job requirements
- ☁️ **Cloud Sync** - Sync your data across devices (optional)
- 🔒 **Privacy First** - Your data stays local unless you enable cloud sync
- 🎨 **Modern UI** - Beautiful dark theme interface

## 🚀 Installation

### Option 1: Download from GitHub (Easiest)

1. **Download the extension:**
   - Go to [Releases](https://github.com/pratik2542/ats-resume-tracker/releases) (or click Code → Download ZIP)
   - Extract the ZIP file
   - Find the `dist` folder inside

2. **Load in Chrome:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right corner)
   - Click **Load unpacked**
   - Select the `dist` folder you extracted
   - Done! The extension icon will appear in your toolbar

### Option 2: Clone from GitHub

```bash
git clone https://github.com/pratik2542/ats-resume-tracker.git
cd ats-resume-tracker
```

Then load the `dist` folder in Chrome as described above.

## 📖 How to Use

### 1️⃣ First Time Setup

1. Click the extension icon in your Chrome toolbar
2. Go to **Settings** tab
3. Add your AI provider API key:
   - **OpenAI**: Get from [platform.openai.com](https://platform.openai.com/api-keys)
   - **Gemini**: Get from [aistudio.google.com](https://aistudio.google.com/app/apikey)

### 2️⃣ Upload Your Resume

1. Click **Upload** tab
2. Upload your resume (PDF or DOCX)
3. Mark it as your default resume
4. Done! Your resume is saved locally

### 3️⃣ Analyze Job Postings

1. Navigate to any job posting (LinkedIn, Indeed, etc.)
2. Click the extension icon
3. The extension automatically extracts job details
4. Click **Analyze Match** to see:
   - ATS compatibility score
   - Missing keywords
   - Improvement suggestions
   - Keyword matches

### 4️⃣ Generate Optimized Resume

1. After analyzing, click **Remake Resume**
2. AI will rewrite your resume to match the job description
3. Review the generated resume
4. Click **Save to Database** to keep it
5. Download as Word or TXT file

### 5️⃣ Create Cover Letter

1. Click **Create Cover Letter** after analysis
2. AI generates a personalized cover letter
3. Click **Save to Database** to keep it
4. Download and use for your application

### 6️⃣ Track Applications

1. Click **Save as Draft** or **Mark as Applied**
2. View all applications in **Dashboard** tab
3. Change status: Draft → Applied → Interviewing → Accepted/Rejected
4. Track your progress with visual stats

## ☁️ Cloud Sync (Optional)

Enable cloud sync to access your data across devices:

1. Go to **Settings** → **Cloud Sync Account**
2. Click **Continue as Guest** or sign in
3. Your data automatically syncs to the cloud
4. Access from any device by signing in

**Note:** Cloud sync uses the developer's Firebase backend. Your data is private and only accessible to you.

## 🎨 Tips & Tricks

### Getting Better Results

- **Be specific with your resume**: Include detailed work experience and skills
- **Use keywords**: The AI looks for keywords from job descriptions
- **Try "Remake" multiple times**: Each attempt uses different creativity levels for variety
- **Review before downloading**: Always review AI-generated content

### Managing Multiple Applications

- Use **Draft** status while preparing materials
- Mark as **Applied** when you submit
- Update to **Interviewing** when you get called
- Track everything in the **Dashboard**

### Privacy & Data

- By default, all data is stored locally in Chrome
- Cloud sync is optional and can be disabled anytime
- No data is shared without your consent
- You can delete applications, resumes, and letters anytime

## 🔧 Supported Job Sites

The extension works on most job posting websites:
- ✅ LinkedIn
- ✅ Indeed
- ✅ Glassdoor
- ✅ Monster
- ✅ ZipRecruiter
- ✅ Company career pages
- ✅ Any webpage with job descriptions

## ❓ FAQ

**Q: Do I need to pay for this extension?**  
A: No! It's completely free. You only need your own AI provider API key (OpenAI or Gemini).

**Q: Is my data safe?**  
A: Yes! Data is stored locally in Chrome. Cloud sync is optional and encrypted.

**Q: Do I need a Firebase account?**  
A: No! The cloud sync uses the developer's Firebase backend. Just sign in with Google or continue as guest.

**Q: Can I use this offline?**  
A: Partially. You can view saved data offline, but AI features require internet connection.

**Q: How much does OpenAI/Gemini API cost?**  
A: Very cheap for personal use. Usually $0.01-0.10 per resume optimization. Gemini offers free tier.

**Q: Can I delete my data?**  
A: Yes! You can delete individual items or clear all data in Settings.

## 🛠️ For Developers

Want to modify or contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

### Build from Source

```bash
# Clone repository
git clone https://github.com/pratik2542/ats-resume-tracker.git
cd ats-resume-tracker

# Install dependencies
npm install

# Build extension
npm run build

# Output will be in dist/ folder
```

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

## 🤝 Support

- 🐛 [Report Issues](https://github.com/pratik2542/ats-resume-tracker/issues)
- 💡 [Feature Requests](https://github.com/pratik2542/ats-resume-tracker/issues/new)
- ⭐ Star this repo if you find it useful!

## 🙏 Credits

Built with:
- React + TypeScript
- Firebase for cloud sync
- OpenAI & Google Gemini APIs
- Webpack for bundling

---

**Made with ❤️ to help job seekers land their dream jobs**

*Good luck with your job search! 🚀*
