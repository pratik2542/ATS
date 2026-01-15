import React, { useState, useEffect, useRef } from 'react';
import { Application, CoverLetter, JobPosting, OptimizedResume, Resume } from '../../types';
import { downloadBlob, downloadDoc, downloadPdf, downloadTxt } from '../utils/download';
import { tryCloudDeleteCoverLetter, tryCloudDeleteOptimizedResume, tryCloudSyncApplication, tryCloudSyncCoverLetter, tryCloudSyncOptimizedResume, tryCloudSyncJob } from '../../firebase/sync';
import { isCloudinaryEnabled, uploadFileToCloudinary } from '../../cloudinary/cloudinary';
import { extractParagraphsFromDocxBase64, patchDocxWithParagraphs } from '../utils/docx';

interface SettingsState {
  openaiApiKey: string;
  geminiApiKey: string;
  aiProvider: 'openai' | 'gemini';
}

interface JobAnalysisProps {
  resume: Resume;
  job: JobPosting;
  settings: SettingsState;
  onBack: () => void;
}

interface AnalysisResult {
  score: number;
  matchDetails: string;
  missingKeywords: string[];
  suggestions: string[];
}

type GeneratedDocState = {
  id: string;
  text: string;
  createdAt: number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const extractJsonObject = (text: string): string => {
  // Remove common markdown fences.
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  // Try to locate the first JSON object in the string.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
};

const stripMarkdownArtifacts = (text: string): string =>
  String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*•\s*\*\s*/gm, '• ')
    .replace(/\r\n/g, '\n');

const stopwords = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','has','have','if','in','into','is','it','its','of','on','or','our','s','such','t','that','the','their','then','there','these','they','this','to','was','we','were','will','with','you','your'
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => w.length >= 3)
    .filter(w => !stopwords.has(w));

const computeHeuristicScore = (resumeText: string, jobText: string): number => {
  const jobWords = tokenize(jobText);
  const resumeWords = tokenize(resumeText);
  if (jobWords.length === 0 || resumeWords.length === 0) return 0;

  // Frequency-based top terms from job description.
  const freq = new Map<string, number>();
  for (const w of jobWords) freq.set(w, (freq.get(w) || 0) + 1);
  const topJobTerms = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([w]) => w);

  const resumeSet = new Set(resumeWords);
  let hit = 0;
  for (const w of topJobTerms) if (resumeSet.has(w)) hit += 1;
  const ratio = hit / Math.max(1, topJobTerms.length);

  // Convert to a more human-looking score curve.
  const score = Math.round(clamp(15 + ratio * 85, 0, 100));
  return score;
};

const includesKeyword = (text: string, keyword: string): boolean => {
  if (!text || !keyword) return false;
  const hay = ` ${text.toLowerCase()} `;
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  // Prefer whole-word-ish matching for alphanumerics.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return re.test(hay);
};

const missingKeywordsFromText = (text: string, keywords: string[]): string[] => {
  const missing: string[] = [];
  for (const k of keywords || []) {
    const kw = String(k || '').trim();
    if (!kw) continue;
    if (!includesKeyword(text, kw)) missing.push(kw);
  }
  return missing;
};

const ScoreRing: React.FC<{ score: number }> = ({ score }) => {
  const radius = 46;
  const stroke = 10;
  const normalized = clamp(score, 0, 100);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (normalized / 100) * circumference;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`Match score ${normalized}%`}>
        <defs>
          <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(139, 92, 246, 1)" />
            <stop offset="60%" stopColor="rgba(6, 182, 212, 1)" />
            <stop offset="100%" stopColor="rgba(34, 197, 94, 1)" />
          </linearGradient>
        </defs>
        <g transform="translate(60, 60)">
          <circle
            r={radius}
            fill="transparent"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={stroke}
          />
          <circle
            r={radius}
            fill="transparent"
            stroke="url(#ringGradient)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90)"
          />
          <text x="0" y="4" textAnchor="middle" fill="rgba(255,255,255,0.92)" fontSize="22" fontWeight="800">
            {normalized}%
          </text>
          <text x="0" y="24" textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="11" fontWeight="700">
            MATCH
          </text>
        </g>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '14px' }}>ATS fit summary</div>
        <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.5 }}>
          {normalized >= 80 ? 'Strong match' : normalized >= 50 ? 'Decent match' : 'Needs improvement'} — optimize keywords and impact.
        </div>
        <div className="progress"><span style={{ width: `${normalized}%` }} /></div>
      </div>
    </div>
  );
};

const JobAnalysis: React.FC<JobAnalysisProps> = ({ resume, job, settings, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');
  const [usedHeuristic, setUsedHeuristic] = useState(false);

  const [generatingResume, setGeneratingResume] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimizedResume, setOptimizedResume] = useState<GeneratedDocState | null>(null);
  const [coverLetter, setCoverLetter] = useState<GeneratedDocState | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<Application['status'] | null>(null);

  const handleDeleteCoverLetter = async (letterId: string) => {
    if (!window.confirm('⚠️ DELETE FROM DATABASE?\n\nThis will permanently remove all versions of this cover letter for this job from both local storage and cloud database.')) return;
    setSaving(true);

    try {
      const result = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['coverLetters'], resolve);
      });
      
      const coverLetters: CoverLetter[] = result.coverLetters || [];
      const targetIds = coverLetters.filter(l => l.jobId === job.id).map(l => l.id);
      
      for (const id of targetIds) {
        try {
          await tryCloudDeleteCoverLetter(id);
        } catch (e) {
          console.error('Cloud delete failed for', id, e);
          throw e;
        }
      }

      const updated = coverLetters.filter(l => l.jobId !== job.id);
      
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ coverLetters: updated }, () => {
          resolve();
        });
      });
      
      setCoverLetter(null);
    } catch (e) {
      console.error('Delete cover letter failed:', e);
      alert('❌ Delete failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOptimizedResume = async (resumeId: string) => {
    if (!window.confirm('⚠️ DELETE FROM DATABASE?\n\nThis will permanently remove all versions of this resume for this job from both local storage and cloud database.')) return;
    
    alert('🗑️ Deleting resume(s)...\n\nPlease wait. Check console (F12) for progress.');
    setSaving(true);
    
    try {
      console.log('[Delete] Starting optimized resume deletion for job:', job.id);
      
      // Get current data
      const result = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['optimizedResumes'], resolve);
      });
      
      const resumes: OptimizedResume[] = result.optimizedResumes || [];
      const targetIds = resumes.filter(res => res.jobId === job.id).map(res => res.id);

      console.log('[Delete] Found optimized resumes to delete:', targetIds);

      // Delete from cloud FIRST and WAIT for completion
      for (const id of targetIds) {
        try {
          await tryCloudDeleteOptimizedResume(id);
        } catch (e) {
          console.error('Cloud delete failed for', id, e);
          throw e;
        }
      }

      const updated = resumes.filter(res => res.jobId !== job.id);
      
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ optimizedResumes: updated }, () => {
          resolve();
        });
      });
      
      setOptimizedResume(null);
      setRewriteFullText('');
    } catch (e) {
      console.error('Delete optimized resume failed:', e);
      alert('❌ Delete failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveGeneratedContent = async () => {
    if (!rewriteFullText) return;
    
    setSaving(true);
    try {
      if (rewriteType === 'resume') {
        // Save optimized resume
        const result = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['optimizedResumes'], resolve);
        });
        
        const optimizedResumes: OptimizedResume[] = result.optimizedResumes || [];
        
        // Check for duplicate
        const existingDuplicate = optimizedResumes.find(or => or.jobId === job.id && or.parsedText === rewriteFullText);
        if (existingDuplicate) {
          setOptimizedResume({ id: existingDuplicate.id, text: rewriteFullText, createdAt: existingDuplicate.uploadDate });
          ensureApplication({ jobId: job.id, resumeId: existingDuplicate.id, status: 'draft' });
          alert('✅ This resume version already exists in database');
          return;
        }

        const id = generateId();
        const name = `${resume.name} — ${job.company} (${job.title})`;
        const optimized: OptimizedResume = {
            id,
            name,
            content: '',
            parsedText: rewriteFullText,
            uploadDate: Date.now(),
            isDefault: false,
            originalResumeId: resume.id,
            jobId: job.id,
            modifications: result?.suggestions || [],
            originalFileUrl: resume.originalFileUrl,
            originalFileProvider: resume.originalFileProvider,
            originalFilePublicId: resume.originalFilePublicId,
            originalFileMimeType: resume.originalFileMimeType,
            originalFileName: resume.originalFileName,
        };

        optimizedResumes.push(optimized);
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ optimizedResumes }, () => {
            resolve();
          });
        });
        
        setOptimizedResume({ id, text: rewriteFullText, createdAt: optimized.uploadDate });
        ensureApplication({ jobId: job.id, resumeId: id, status: 'draft' });
        await tryCloudSyncOptimizedResume(optimized);
        
        alert('✅ Resume saved to database');
      } else {
        // Save cover letter
        const result = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['coverLetters'], resolve);
        });
        
        const coverLetters: CoverLetter[] = result.coverLetters || [];
        
        // Check for duplicate
        const existingDuplicate = coverLetters.find(cl => cl.jobId === job.id && cl.content === rewriteFullText);
        if (existingDuplicate) {
          setCoverLetter({ id: existingDuplicate.id, text: rewriteFullText, createdAt: existingDuplicate.createdDate });
          ensureApplication({ jobId: job.id, coverLetterId: existingDuplicate.id, status: 'draft' });
          alert('✅ This cover letter already exists in database');
          return;
        }

        const id = generateId();
        const letter: CoverLetter = {
            id,
            jobId: job.id,
            content: rewriteFullText,
            createdDate: Date.now(),
        };

        coverLetters.push(letter);
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ coverLetters }, () => {
            resolve();
          });
        });
        
        setCoverLetter({ id, text: rewriteFullText, createdAt: letter.createdDate });
        ensureApplication({ jobId: job.id, coverLetterId: id, status: 'draft' });
        await tryCloudSyncCoverLetter(letter);
        
        alert('✅ Cover letter saved to database');
      }
    } catch (e) {
      console.error('Save failed:', e);
      alert('❌ Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canGenerateResume = Boolean(
    !loading &&
      result &&
      (settings.aiProvider === 'gemini' ? settings.geminiApiKey : settings.openaiApiKey)
  );

  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteStatus, setRewriteStatus] = useState<'idle' | 'generating' | 'typing' | 'done' | 'error' | 'cancelled'>('idle');
  const [rewriteError, setRewriteError] = useState<string>('');
  const [rewriteFullText, setRewriteFullText] = useState<string>('');
  const [rewriteDisplayedText, setRewriteDisplayedText] = useState<string>('');
  const [generationAttempts, setGenerationAttempts] = useState(0);
  const [rewriteType, setRewriteType] = useState<'resume' | 'coverLetter'>('resume');

  const rewriteAbortRef = useRef<AbortController | null>(null);
  const rewriteTimerRef = useRef<number | null>(null);
  const generatedTextareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((rewriteStatus === 'typing' || rewriteStatus === 'done') && generatedTextareaRef.current) {
      generatedTextareaRef.current.scrollTop = generatedTextareaRef.current.scrollHeight;
    }
  }, [rewriteStatus, rewriteDisplayedText]);

  useEffect(() => {
    analyzeMatch();
    // Ensure job data is synced to cloud (for multi-device access)
    void tryCloudSyncJob(job).catch(console.warn);
  }, []);

  useEffect(() => {
    // Load any existing docs for this job so you can keep track.
    chrome.storage.local.get(['optimizedResumes', 'coverLetters', 'applications'], (r) => {
      const optimizedResumes: OptimizedResume[] = r.optimizedResumes || [];
      const coverLetters: CoverLetter[] = r.coverLetters || [];
      const applications: Application[] = r.applications || [];

      const latestResume = optimizedResumes
        .filter(or => or.jobId === job.id)
        .sort((a, b) => (b.uploadDate || 0) - (a.uploadDate || 0))[0];
      if (latestResume?.parsedText) {
        setOptimizedResume({ id: latestResume.id, text: latestResume.parsedText, createdAt: latestResume.uploadDate });
      }

      const latestLetter = coverLetters
        .filter(cl => cl.jobId === job.id)
        .sort((a, b) => b.createdDate - a.createdDate)[0];
      if (latestLetter?.content) {
        setCoverLetter({ id: latestLetter.id, text: latestLetter.content, createdAt: latestLetter.createdDate });
      }

      const app = applications.find(a => a.jobId === job.id);
      if (app) setApplicationStatus(app.status);
    });
  }, [job.id]);

  const generateId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const ensureApplication = (patch: Partial<Application> & { jobId: string }) => {
    setSaving(true);
    
    // Ensure job is saved first
    chrome.storage.local.get(['jobs'], (jr) => {
      const jobs: JobPosting[] = jr.jobs || [];
      const jobExists = jobs.find(j => j.id === job.id);
      
      if (!jobExists) {
        jobs.push(job);
        chrome.storage.local.set({ jobs });
        void tryCloudSyncJob(job).catch(console.warn);
      }
      
      // Then handle application
      chrome.storage.local.get(['applications'], (r) => {
        const applications: Application[] = r.applications || [];
        const existing = applications.find(a => a.jobId === patch.jobId);

        if (existing) {
          Object.assign(existing, patch);
          chrome.storage.local.set({ applications }, () => {
            setApplicationStatus(existing.status);
            tryCloudSyncApplication(existing)
              .catch((e) => console.warn('Cloud sync (application) failed:', e))
              .finally(() => setSaving(false));
          });
          return;
        }

        const created: Application = {
          id: generateId(),
          jobId: patch.jobId,
          resumeId: patch.resumeId || resume.id,
          coverLetterId: patch.coverLetterId,
          appliedDate: patch.appliedDate || Date.now(),
          status: (patch.status as Application['status']) || 'draft',
        };
        applications.push(created);
        chrome.storage.local.set({ applications }, () => {
          setApplicationStatus(created.status);
          tryCloudSyncApplication(created)
            .catch((e) => console.warn('Cloud sync (application) failed:', e))
            .finally(() => setSaving(false));
        });
      });
    });
  };

  const markApplied = () => {
    ensureApplication({ jobId: job.id, status: 'applied', appliedDate: Date.now() });
  };

  const containsPlaceholderTokens = (text: string): boolean => {
    if (!text) return false;
    const lower = text.toLowerCase();
    if (lower.includes('[your name]')) return true;
    if (lower.includes('[name]')) return true;
    if (lower.includes('[city')) return true;
    if (lower.includes('[phone')) return true;
    if (lower.includes('[email')) return true;
    if (lower.includes('[linkedin')) return true;
    if (lower.includes('[github')) return true;
    if (/\[[^\]]{2,}\]/.test(text)) return true;
    return false;
  };

  const extractEmail = (text: string): string | null => {
    const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m?.[0] || null;
  };

  const buildOptimizedResumePrompt = (): string => {
    const suggestions = result?.suggestions?.map(s => `- ${s}`).join('\n') || '';
    const missing = result?.missingKeywords?.map(k => `- ${k}`).join('\n') || '';

    return `
You are an expert ATS resume editor.

GOAL:
- REWRITE the resume content to MAXIMIZE relevance to the specific job, while remaining truthful.

STRICT REQUIREMENTS (MUST FOLLOW):
- Use the ORIGINAL RESUME as the single source of truth for ALL personal details.
- Preserve the resume layout EXACTLY: same section headings, order, and line breaks.
- IMPORTANT: Keep the EXACT SAME NUMBER OF LINES as the original resume input. Do not add/remove lines. Only edit the text on existing lines.
- Keep all contact/personal details exactly as in the original resume (name, email, phone, links, location). Do NOT rewrite them.
- Do NOT use placeholders (no [Your Name], [CITY], [PHONE], [EMAIL], etc). If a detail is missing in the original resume, OMIT it.
- Do NOT invent experience, companies, dates, degrees, or metrics.
- Do NOT add new sections unless they already exist in the original resume.
- AGGRESSIVELY rewrite bullet points to use keywords from the job description.
- Replace generic phrases with specific, result-oriented language from the JD if applicable.
- Output PLAIN TEXT ONLY. No markdown. No backticks.

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${job.description}

SUGGESTIONS TO INCORPORATE (ONLY IF TRUE):
${suggestions}

MISSING KEYWORDS TO WEAVE IN (ONLY IF TRUE):
${missing}

ORIGINAL RESUME (DO NOT CHANGE FORMATTING):
${resume.parsedText}

OUTPUT:
- Return the updated resume ONLY.
    `.trim();
  };

  const buildOptimizedResumeParagraphsPrompt = (originalParagraphs: string[]): string => {
    const suggestions = result?.suggestions?.map(s => `- ${s}`).join('\n') || '';
    const missing = result?.missingKeywords?.map(k => `- ${k}`).join('\n') || '';

    const nonEmpty = originalParagraphs
      .map((p, i) => ({ i: i + 1, t: String(p ?? '') }))
      .filter((x) => x.t.trim().length > 0);

    const numbered = nonEmpty.map((x) => `${x.i}. ${x.t}`).join('\n');

    return `
You are an expert ATS resume editor.

GOAL:
- REWRITE the resume content to MAXIMIZE relevance to the specific job, while remaining truthful.

CRITICAL OUTPUT FORMAT (MUST FOLLOW):
- Output MUST be valid JSON ONLY.
- Shape: { "replacements": [ { "index": 1, "text": "New Text" }, ... ] }
- "index" must be the integer 1-based paragraph index shown below.
- "text" must be the refined paragraph text (single line, no newlines).
- ONLY include paragraphs that you have modified.
- If a paragraph is unchanged, DO NOT include it in the JSON.
- If no changes are needed for a paragraph, return an empty "replacements" array.

STRICT CONTENT RULES:
- Use the ORIGINAL RESUME as the single source of truth for all personal details.
- Keep contact details exactly as-is (name, email, phone, links, location).
- Do not invent experience, companies, dates, degrees, certifications, or metrics.
- Do NOT add or remove sections; do NOT add new paragraphs.
- AGGRESSIVELY rewrite bullet points to use keywords from the job description.
- Replace generic phrases with specific, result-oriented language from the JD if applicable.
- No markdown, no **bold**, no bullet characters like "•" unless they already appear in that paragraph.

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${job.description}

SUGGESTIONS TO INCORPORATE (ONLY IF TRUE):
${suggestions}

MISSING KEYWORDS TO WEAVE IN (ONLY IF TRUE):
${missing}

ORIGINAL RESUME NON-EMPTY PARAGRAPHS (Indices 1..${originalParagraphs.length}):
${numbered}

OUTPUT JSON (replacements only):
`.trim();
  };

  const mergeParagraphsJson = (raw: string, original: string[]): string[] => {
    const jsonText = extractJsonObject(raw);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('AI did not return valid JSON for DOCX content.');
    }

    // Support legacy/fallback format: { paragraphs: [...] }
    if (Array.isArray(parsed?.paragraphs)) {
      const arr = parsed.paragraphs;
      if (arr.length !== original.length) {
        throw new Error(`AI returned full paragraph list but count mismatch: expected ${original.length}, got ${arr.length}.`);
      }
      return arr.map((p: any) => stripMarkdownArtifacts(String(p ?? '')).replace(/\n/g, ''));
    }

    // Support schema format: { replacements: [ { "index": 1, "text": "..." }, ... ] }
    if (Array.isArray(parsed?.replacements)) {
      const newParagraphs = [...original];
      parsed.replacements.forEach((item: any) => {
        const idx = Number(item?.index);
        const text = String(item?.text ?? '');
        if (!Number.isNaN(idx) && idx >= 1 && idx <= original.length) {
          newParagraphs[idx - 1] = stripMarkdownArtifacts(text).replace(/\n/g, '');
        }
      });
      return newParagraphs;
    }

    // Support optimized object map format: { replacements: { "1": "...", "5": "..." } }
    const replacements = parsed?.replacements || parsed;
    if (typeof replacements === 'object' && replacements !== null) {
      const newParagraphs = [...original];
      let updateCount = 0;
      Object.entries(replacements).forEach(([key, val]) => {
        const idx = parseInt(key, 10);
        if (!Number.isNaN(idx) && idx >= 1 && idx <= original.length) {
          newParagraphs[idx - 1] = stripMarkdownArtifacts(String(val ?? '')).replace(/\n/g, '');
          updateCount++;
        }
      });
      return newParagraphs;
    }

    throw new Error('AI JSON is not a valid replacements format.');
  };

  const downloadOptimizedDocxPreservingFormat = async (optimizedText: string) => {
    try {
      const originalName = (resume.originalFileName || '').toLowerCase();
      if (!originalName.endsWith('.docx')) {
        throw new Error('Format-preserving download requires a .docx resume upload.');
      }
      if (!resume.content) {
        throw new Error('Original DOCX content is missing in local storage. Please re-upload your resume.');
      }
      const originalParagraphs = await extractParagraphsFromDocxBase64(resume.content);
      const normalized = stripMarkdownArtifacts(String(optimizedText || ''));
      const updatedParagraphs = normalized.split('\n');
      if (updatedParagraphs.length !== originalParagraphs.length) {
        throw new Error(
          `This optimized text does not match your DOCX layout (expected ${originalParagraphs.length} paragraphs, got ${updatedParagraphs.length}). Please click “Remake Resume” again.`
        );
      }
      const { blob } = await patchDocxWithParagraphs(resume.content, updatedParagraphs);
      const filename = `${resume.name}-${job.company}-${job.title}-resume.docx`;
      downloadBlob(filename, blob);
    } catch (e) {
      const msg = (e as Error).message || 'Failed to create DOCX download';
      console.error(msg);
      setRewriteError(msg);
      setError(msg);
      // Alert the user so they definitely know something went wrong
      alert(`Download Error: ${msg}`);
    }
  };

  const stopRewriteTimers = () => {
    if (rewriteTimerRef.current != null) {
      window.clearInterval(rewriteTimerRef.current);
      rewriteTimerRef.current = null;
    }
  };

  const closeRewriteModal = () => {
    stopRewriteTimers();
    rewriteAbortRef.current?.abort();
    rewriteAbortRef.current = null;
    setRewriteOpen(false);
  };

  const cancelRewrite = () => {
    rewriteAbortRef.current?.abort();
    setRewriteStatus('cancelled');
    setRewriteError('Cancelled.');
  };

  const startTypewriter = (text: string) => {
    stopRewriteTimers();
    setRewriteDisplayedText('');
    setRewriteStatus('typing');

    // Type in chunks to keep it fast for long resumes.
    const chunkSize = 18;
    const intervalMs = 18;
    let i = 0;
    rewriteTimerRef.current = window.setInterval(() => {
      i = Math.min(text.length, i + chunkSize);
      setRewriteDisplayedText(text.slice(0, i));
      if (i >= text.length) {
        stopRewriteTimers();
        setRewriteStatus('done');
      }
    }, intervalMs);
  };

  const buildCoverLetterPrompt = (): string => {
    const suggestions = result?.suggestions?.map(s => `- ${s}`).join('\n') || '';

    return `
You are a professional career coach.

TASK:
- Write a tailored cover letter for this job using ONLY details found in the resume.

STRICT REQUIREMENTS (MUST FOLLOW):
- No placeholders (no [Your Name], [CITY], etc). If a detail is missing in the resume, OMIT it.
- Do NOT invent companies, dates, degrees, certifications, or metrics.
- Use the candidate's real name/contact details from the resume IF PRESENT; otherwise do not fabricate them.
- Keep it specific to the job and company; avoid generic filler.
- Output plain text only (no markdown).
- 220-350 words.
- Structure:
  1) Short intro
  2) Why this role/company (1 short paragraph)
  3) Proof of fit (2-3 bullets grounded in resume)
  4) Closing (If name is present in resume, sign with that name; otherwise end without a name.)

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${job.description}

RESUME (SOURCE OF TRUTH):
${resume.parsedText}

OPTIONAL ATS SUGGESTIONS:
${suggestions}

COVER LETTER:
    `.trim();
  };
 

  const callGeminiTextAPI = async (
    prompt: string,
    apiKey: string,
    temperature = 0.25,
    signal?: AbortSignal,
    responseMimeType?: 'application/json' | 'text/plain',
    responseSchema?: any
  ): Promise<string> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          ...(responseMimeType ? { responseMimeType } : {}),
          ...(responseSchema ? { responseSchema } : {}),
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const generateOptimizedResume = async () => {
    if (!result) return;
    setGeneratingResume(true);
    setError('');

    // Interactive modal UX
    setRewriteOpen(true);
    setRewriteType('resume');
    setRewriteStatus('generating');
    setRewriteError('');
    setRewriteFullText('');
    setRewriteDisplayedText('');
    stopRewriteTimers();

    rewriteAbortRef.current?.abort();
    rewriteAbortRef.current = new AbortController();

    const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      let timer: number | null = null;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => {
            rewriteAbortRef.current?.abort();
            reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. Please try again.`));
          }, ms);
        });
        return await Promise.race([p, timeout]);
      } finally {
        if (timer != null) window.clearTimeout(timer);
      }
    };

    try {
      const isDocx = (resume.originalFileName || '').toLowerCase().endsWith('.docx');
      const originalParagraphs = isDocx && resume.content ? await extractParagraphsFromDocxBase64(resume.content) : null;
      const prompt = originalParagraphs ? buildOptimizedResumeParagraphsPrompt(originalParagraphs) : buildOptimizedResumePrompt();
      const resumeEmail = extractEmail(resume.parsedText || '');

      // Calculate temperature based on generation attempts: more attempts = higher temperature (more creative)
      const attemptBasedTemperature = generationAttempts === 1 ? 0.25 :
                                       generationAttempts === 2 ? 0.4 :
                                       generationAttempts === 3 ? 0.6 : 0.8;

      const runOnce = async (p: string) => {
        if (settings.aiProvider === 'gemini') {
          if (!settings.geminiApiKey) throw new Error('Gemini API key is missing');
          
          let schema: any = undefined;
          if (originalParagraphs) {
            schema = {
              type: "OBJECT",
              properties: {
                replacements: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      index: { type: "INTEGER" },
                      text: { type: "STRING" }
                    },
                    required: ["index", "text"]
                  }
                }
              },
              required: ["replacements"]
            };
          }

          return withTimeout(
            callGeminiTextAPI(
              p,
              settings.geminiApiKey,
              attemptBasedTemperature,
              rewriteAbortRef.current?.signal,
              originalParagraphs ? 'application/json' : undefined,
              schema
            ),
            120000,
            'Gemini request'
          );
        }
        if (!settings.openaiApiKey) throw new Error('OpenAI API key is missing');
        return withTimeout(
          callOpenAIAPI(p, settings.openaiApiKey, attemptBasedTemperature, rewriteAbortRef.current?.signal),
          90000,
          'OpenAI request'
        );
      };

      const originalHeuristic = computeHeuristicScore(resume.parsedText || '', job.description || '');

      const raw = (await runOnce(prompt)).trim();

      let cleaned = '';
      if (originalParagraphs) {
        try {
          const paragraphs = mergeParagraphsJson(raw, originalParagraphs);
          cleaned = paragraphs.join('\n');
        } catch (err) {
          const repairPrompt = `
Your previous response was not valid JSON or followed the wrong format.

Return valid JSON ONLY.

Format: { "replacements": [ { "index": 1, "text": "New Text" }, ... ] }
- "index": integer (1-based index).
- "text": string.

Original response was invalid:
${raw}
          `.trim();
          const raw2 = (await runOnce(repairPrompt)).trim();
          const paragraphs2 = mergeParagraphsJson(raw2, originalParagraphs);
          cleaned = paragraphs2.join('\n');
        }
      } else {
        cleaned = stripMarkdownArtifacts(raw).replace(/```/g, '').trim();
      }
      if (!cleaned) throw new Error('AI returned empty resume text');

      const needsRetry = containsPlaceholderTokens(cleaned) || (resumeEmail && !cleaned.includes(resumeEmail));
      if (needsRetry) {
        if (originalParagraphs) {
          const repairPrompt = `
Your previous output violated requirements (contained placeholders or removed personal details).

Task: Provide the REPLACEMENTS JSON again, but this time ensure NO placeholders are used.

STRICT REQUIREMENTS:
- Use the ORIGINAL RESUME details for name/email/phone.
- Output ONLY valid JSON: { "replacements": [ { "index": 1, "text": "..." }, ... ] }
- "index": 1-based index from the original list.

JOB DESCRIPTION:
${job.description}

ORIGINAL RESUME:
${resume.parsedText}

BAD OUTPUT (contained placeholders):
${cleaned}
          `.trim();

          const raw2 = (await runOnce(repairPrompt)).trim();
          const paragraphs2 = mergeParagraphsJson(raw2, originalParagraphs);
          cleaned = paragraphs2.join('\n');

        } else {
          const repairPrompt = `
Your previous output violated requirements (it contained placeholders and/or removed real contact details).

Fix it now.

STRICT REQUIREMENTS:
- Keep ALL real personal details exactly as in the original resume (name/email/phone/links/location).
- Remove ALL placeholders like [Your Name], [CITY], [PHONE], [EMAIL]. Never use bracket placeholders.
- Preserve the original resume formatting EXACTLY (line breaks/spacing/sections).
- Make minimal, truthful edits to better match the job.

JOB DESCRIPTION:
${job.description}

ORIGINAL RESUME:
${resume.parsedText}

BAD OUTPUT TO FIX:
${cleaned}

OUTPUT: Updated resume only.
          `.trim();

          cleaned = (await runOnce(repairPrompt)).replace(/```/g, '').trim();
        }
      }

      // Iterative refinement: try to close keyword gaps and push the heuristic closer to 100.
      const targetKeywords = Array.isArray(result.missingKeywords) ? result.missingKeywords : [];
      let pass1Heuristic = computeHeuristicScore(cleaned || '', job.description || ''); // use let to update if needed
      const missingAfterPass1 = missingKeywordsFromText(cleaned || '', targetKeywords);

      if ((missingAfterPass1.length > 0 || pass1Heuristic < 95) && targetKeywords.length > 0) {
        let refinePrompt = '';

        if (originalParagraphs) {
            // DOCX / JSON Mode Refinement
            const nonEmpty = originalParagraphs
                .map((p, i) => ({ i: i + 1, t: String(p ?? '') }))
                .filter((x) => x.t.trim().length > 0);
            
            const numbered = nonEmpty.map((x) => `${x.i}. ${x.t}`).join('\n');

            refinePrompt = `
You are an expert ATS resume editor.

GOAL: Finalize the resume to close keyword gaps and reach 100% match.

STATUS:
- We have a FIRST DRAFT (from your previous turn).
- It is still missing these keywords: ${missingAfterPass1.join(', ')}.

TASK:
- output a COMPLETE list of replacements for the ORIGINAL PARAGRAPHS.
- You must include BOTH your previous edits (if they were good) AND new edits to fix the missing keywords.
- Any paragraph not listed in "replacements" will revert to the ORIGINAL text.

CRITICAL OUTPUT FORMAT:
- valid JSON ONLY: { "replacements": [ { "index": 1, "text": "..." }, ... ] }
- "index": must match the ORIGINAL PARAGRAPHS list below.

ORIGINAL PARAGRAPHS (Indices 1..${originalParagraphs.length}):
${numbered}

FIRST DRAFT TEXT (For Reference):
${cleaned}

OUTPUT JSON (replacements):
            `.trim();
        } else {
            // Text / Plain Mode Refinement
            refinePrompt = `
You are an expert ATS resume editor.

GOAL:
- Maximize ATS match for the job (aim for 100), while staying strictly truthful.

NON-NEGOTIABLE RULES:
- Do not invent experience, companies, dates, degrees, certifications, metrics.
- Keep ALL personal/contact details exactly as in the original resume.
- No placeholders.

JOB DESCRIPTION:
${job.description}

ORIGINAL RESUME (source of truth):
${resume.parsedText}

CURRENT UPDATED RESUME:
${cleaned}

KEYWORDS STILL MISSING:
${missingAfterPass1.map(k => `- ${k}`).join('\n')}

OUTPUT:
- Return the updated resume text only.
            `.trim();
        }
        
        const refinedRaw = (await runOnce(refinePrompt)).trim();
        
        if (originalParagraphs) {
          try {
            const paragraphs = mergeParagraphsJson(refinedRaw, originalParagraphs);
            // Only accept if we got a valid result
            if (paragraphs.length > 0) {
                cleaned = paragraphs.join('\n');
                pass1Heuristic = computeHeuristicScore(cleaned, job.description || ''); // Update score
            }
          } catch (e) {
            console.warn('Refinement failed to parse JSON, ignoring.', e);
          }
        } else {
          const refined = refinedRaw.replace(/```/g, '').trim();
          if (refined) cleaned = refined;
        }
      }

      if (!cleaned) throw new Error('AI returned empty resume text');
      if (containsPlaceholderTokens(cleaned)) {
        throw new Error('Generated resume still contains placeholders. Please ensure your resume text includes your real details (name/email/phone) and try again.');
      }
      if (resumeEmail && !cleaned.includes(resumeEmail)) {
        throw new Error('Generated resume removed your email. Please try again.');
      }

      const finalHeuristic = computeHeuristicScore(cleaned || '', job.description || '');
      if (finalHeuristic < Math.max(70, originalHeuristic + 10)) {
        console.warn('Optimized resume heuristic did not improve much:', { originalHeuristic, finalHeuristic });
      }

      chrome.storage.local.get(['optimizedResumes'], (r) => {
        const optimizedResumes: OptimizedResume[] = r.optimizedResumes || [];
        
        // A simple duplicate check for EXACT text match on this job.
        // We probably also want to prevent saving if the user just generated the EXACT same text again.
        const existingDuplicate = optimizedResumes.find(or => or.jobId === job.id && or.parsedText === cleaned);
        if (existingDuplicate) {
             // If duplicate found, just update the local state to point to it, don't save a new copy.
             setOptimizedResume({ id: existingDuplicate.id, text: cleaned, createdAt: existingDuplicate.uploadDate });
             setRewriteFullText(cleaned);
             startTypewriter(cleaned);
             return;
        }

        // Don't save to storage automatically - just show in modal
        // User must explicitly click "Save" to persist
        setRewriteFullText(cleaned);
        startTypewriter(cleaned);
      });

      if (!rewriteError) {
        setRewriteFullText(cleaned);
        startTypewriter(cleaned);
      }
    } catch (e) {
      const err = e as any;
      if (err?.name === 'AbortError') {
        setRewriteStatus('cancelled');
        setRewriteError('Cancelled.');
      } else {
        const msg = (e as Error).message || 'Failed to generate optimized resume';
        setRewriteStatus('error');
        setRewriteError(msg);
        setError(msg);
      }
    } finally {
      setGeneratingResume(false);
    }
  };


  const handleSaveAndSync = async () => {
    setSaving(true);
    try {
      // 1. Mark as draft locally
      ensureApplication({ jobId: job.id, status: 'draft' });

      // 2. Logic to upload Word to Cloudinary if enabled
      if (optimizedResume && isCloudinaryEnabled()) {
        chrome.storage.local.get(['optimizedResumes'], async (r) => {
          const all: OptimizedResume[] = r.optimizedResumes || [];
          const current = all.find(x => x.id === optimizedResume.id);
          
          if (current) {
            // Generate Blob
            let blob: Blob | null = null;
            const isDocx = (resume.originalFileName || '').toLowerCase().endsWith('.docx');
            
            if (isDocx && resume.content) {
               try {
                 const originalParagraphs = await extractParagraphsFromDocxBase64(resume.content);
                 const normalized = stripMarkdownArtifacts(String(optimizedResume.text || ''));
                 const updatedParagraphs = normalized.split('\n');
                 // Patch
                 const res = await patchDocxWithParagraphs(resume.content, updatedParagraphs);
                 blob = res.blob;
               } catch (e) {
                 console.warn('Failed to generate DOCX for upload:', e);
               }
            } else {
               // Fallback: Upload text as text/plain or create a simple doc?
               // The user specifically asked for "word format". 
               // Without a library to create DOCX from scratch, we can only create a fake .doc (html) or text.
               // We'll skip non-docx resume upload for now or just upload text.
               blob = new Blob([optimizedResume.text], { type: 'text/plain' });
            }

            if (blob) {
               const filename = `${current.name}.docx`; 
               const uploadRes = await uploadFileToCloudinary(blob, { filename, folder: 'ats-optimized' });
               
               // Update locally
               current.originalFileUrl = uploadRes.secureUrl;
               current.originalFileProvider = 'cloudinary';
               
               const updatedList = all.map(x => x.id === current.id ? current : x);
               await chrome.storage.local.set({ optimizedResumes: updatedList });
               
               // Sync to Firebase
               await tryCloudSyncOptimizedResume(current);
            }
          }
        });
      }
    } catch (e) {
      console.error('Save failed:', e);
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const generateCoverLetter = async () => {
    if (!result) return;
    setGeneratingCover(true);
    setError('');

    // Open modal for typewriter effect if desired, or reuse existing variables?
    // User asked for "same animation as resume".
    setRewriteOpen(true);
    setRewriteType('coverLetter');
    setRewriteStatus('generating');
    setRewriteError('');
    setRewriteFullText('');
    setRewriteDisplayedText('');
    stopRewriteTimers();

    rewriteAbortRef.current?.abort();
    rewriteAbortRef.current = new AbortController();

    try {
      // Use optimized resume if available, else original
      const resumeContext = optimizedResume?.text || resume.parsedText;
      
      const prompt = `
You are a professional career coach.

TASK:
- Write a tailored cover letter for this job using ONLY details found in the resume.

STRICT REQUIREMENTS (MUST FOLLOW):
- No placeholders (no [Your Name], [CITY], etc). If a detail is missing in the resume, OMIT it.
- Do NOT invent companies, dates, degrees, certifications, or metrics.
- Use the candidate's real name/contact details from the resume IF PRESENT; otherwise do not fabricate them.
- Keep it specific to the job and company; avoid generic filler.
- Output plain text only (no markdown).
- 220-350 words.
- Structure:
  1) Short intro
  2) Why this role/company (1 short paragraph)
  3) Proof of fit (2-3 bullets grounded in resume)
  4) Closing (If name is present in resume, sign with that name; otherwise end without a name.)

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${job.description}

RESUME (SOURCE OF TRUTH):
${resumeContext}

OPTIONAL ATS SUGGESTIONS:
${result?.suggestions?.map(s => `- ${s}`).join('\n') || ''}

COVER LETTER:
    `.trim();

      // Calculate temperature based on generation attempts: more attempts = higher temperature (more creative)
      const attemptBasedTemperature = generationAttempts === 1 ? 0.25 :
                                       generationAttempts === 2 ? 0.4 :
                                       generationAttempts === 3 ? 0.6 : 0.8;

      const runOnce = async (p: string) => {
        if (settings.aiProvider === 'gemini') {
          if (!settings.geminiApiKey) throw new Error('Gemini API key is missing');
          return callGeminiTextAPI(p, settings.geminiApiKey, attemptBasedTemperature, rewriteAbortRef.current?.signal);
        }
        if (!settings.openaiApiKey) throw new Error('OpenAI API key is missing');
        // @ts-ignore
        return callOpenAIAPI(p, settings.openaiApiKey, attemptBasedTemperature, rewriteAbortRef.current?.signal);
      };

      let cleaned = await runOnce(prompt);
      cleaned = stripMarkdownArtifacts(cleaned).replace(/```/g, '').trim();

      if (!cleaned) throw new Error('AI returned empty cover letter');

      const needsRetry = containsPlaceholderTokens(cleaned);
      if (needsRetry) {
          const repairPrompt = `
Your previous cover letter used placeholders like [Your Name]/[CITY]/[PHONE].

Fix it now.

STRICT RULES:
- No placeholders at all.
- Only use real details found in the resume; if missing, omit.
- Do not invent facts.

JOB DESCRIPTION:
${job.description}

RESUME:
${resumeContext}

BAD OUTPUT TO FIX:
${cleaned}

OUTPUT: Cover letter only.
        `.trim();
        cleaned = (await runOnce(repairPrompt)).replace(/```/g, '').trim();
      }

      if (!cleaned) throw new Error('AI returned empty cover letter');
      if (containsPlaceholderTokens(cleaned)) {
        throw new Error('Generated cover letter still contains placeholders. Please try again.');
      }

      chrome.storage.local.get(['coverLetters'], (r) => {
        const coverLetters: CoverLetter[] = r.coverLetters || [];
        
        const existingDuplicate = coverLetters.find(cl => cl.jobId === job.id && cl.content === cleaned);
        if (existingDuplicate) {
             setCoverLetter({ id: existingDuplicate.id, text: cleaned, createdAt: existingDuplicate.createdDate });
             
             if (!rewriteError) {
                setRewriteFullText(cleaned);
                startTypewriter(cleaned);
             }
             return;
        }

        // Don't save to storage automatically - just show in modal
        // User must explicitly click "Save" to persist
        if (!rewriteError) {
          setRewriteFullText(cleaned);
          startTypewriter(cleaned);
        }
      });
    } catch (e) {
      const err = e as any;
      if (err?.name === 'AbortError') {
         setRewriteStatus('cancelled');
         setRewriteError('Cancelled.');
      } else {
         setError((e as Error).message || 'Failed to generate cover letter');
         setRewriteStatus('error');
         setRewriteError((e as Error).message);
      }
    } finally {
      setGeneratingCover(false);
    }
  };

  const analyzeMatch = async (arg?: string | React.MouseEvent) => {
    // If arg is a string, use it. Otherwise (undefined or event), fallback to original resume.
    const textToAnalyze = typeof arg === 'string' ? arg : resume.parsedText;
    
    setLoading(true);
    setError('');
    setUsedHeuristic(false);

    try {
      const prompt = `
You are an expert ATS (Applicant Tracking System) matcher.

TASK:
- Compare the resume to the job description.
- Output STRICT JSON ONLY (no markdown, no backticks, no extra text).

SCORING RULES:
- score must be an INTEGER from 0 to 100 (not a string).
- If information is missing/unclear, still estimate a score (do not default to 0).

OUTPUT JSON SHAPE:
{
  "score": 0,
  "matchDetails": "Max 2 sentences.",
  "missingKeywords": ["..."],
  "suggestions": ["..."]
}

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${job.description}

RESUME TEXT:
${textToAnalyze}
      `.trim();

      let responseText = '';

      if (settings.aiProvider === 'gemini') {
        if (!settings.geminiApiKey) {
          throw new Error('Gemini API key is missing');
        }
        responseText = await callGeminiAPI(prompt, settings.geminiApiKey);
      } else {
        if (!settings.openaiApiKey) {
          throw new Error('OpenAI API key is missing');
        }
        responseText = await callOpenAIAPI(prompt, settings.openaiApiKey);
      }

      const jsonOnly = extractJsonObject(responseText);
      const data = JSON.parse(jsonOnly);

      const aiScore = Number(data?.score);
      const safeScore = Number.isFinite(aiScore) ? clamp(aiScore, 0, 100) : NaN;

      const heuristic = computeHeuristicScore(resume.parsedText || '', job.description || '');
      const shouldFallback = !Number.isFinite(safeScore) || (safeScore === 0 && heuristic >= 20);

      const finalScore = shouldFallback ? heuristic : safeScore;
      setUsedHeuristic(shouldFallback);

      setResult({
        score: Math.round(finalScore),
        matchDetails: typeof data?.matchDetails === 'string' && data.matchDetails.trim().length > 0
          ? data.matchDetails
          : 'Match summary unavailable from AI response; score estimated from keyword overlap.',
        missingKeywords: Array.isArray(data?.missingKeywords) ? data.missingKeywords : [],
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
      });
    } catch (err) {
      console.error('Analysis failed:', err);
      setError((err as Error).message || 'Analysis failed. Please check your API key.');
    } finally {
      setLoading(false);
    }
  };

  const callGeminiAPI = async (prompt: string, apiKey: string, signal?: AbortSignal): Promise<string> => {
    // Use a stable model and request JSON when supported.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const callOpenAIAPI = async (prompt: string, apiKey: string, temperature = 0.7, signal?: AbortSignal): Promise<string> => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      signal,
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful ATS resume analyzer.' },
          { role: 'user', content: prompt }
        ],
        temperature
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  return (
    <div className="analysis-view">
      <div className="header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <div className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">Match Analysis</h1>
            <p className="topbar-subtitle">Resume vs job description</p>
          </div>
          <div className="topbar-actions">
            <span className="pill" title="Provider in use">
              <span className="pill-dot" />
              {settings.aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'}
            </span>
            <button
              className="icon-button"
              onClick={analyzeMatch}
              title="Re-run analysis"
              aria-label="Re-run analysis"
              disabled={loading}
            >
              ⟳
            </button>
          </div>
        </div>
      </div>

      <div className="content">
        {loading && (
          <div className="status-card">
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="spinner" />
                <div style={{ display: 'grid', gap: '6px', flex: 1 }}>
                  <div style={{ fontWeight: 800 }}>Analyzing…</div>
                  <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                    Using {settings.aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} to score your match.
                  </div>
                </div>
              </div>
              <div className="skeleton" style={{ height: '14px' }} />
              <div className="skeleton" style={{ height: '14px', width: '80%' }} />
              <div className="skeleton" style={{ height: '80px' }} />
            </div>
          </div>
        )}

        {error && (
          <div className="alert warning">
            <span className="alert-icon">⚠️</span>
            <div>
              <strong>Error</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {result && !loading && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <div className="status-card">
              <ScoreRing score={result.score} />
              {usedHeuristic && (
                <div style={{ marginTop: '10px' }}>
                  <span className="chip info">Score estimated (keyword overlap)</span>
                </div>
              )}
              <div style={{ marginTop: '12px', color: 'var(--muted)', fontSize: '13px', lineHeight: 1.6 }}>
                {result.matchDetails}
              </div>
            </div>

            <div className="status-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                <div style={{ fontWeight: 800 }}>🛑 Missing keywords</div>
                <span className="chip danger">{result.missingKeywords.length}</span>
              </div>
              <div className="chip-row">
                {result.missingKeywords.length === 0 ? (
                  <span className="chip success">No gaps detected</span>
                ) : (
                  result.missingKeywords.map((keyword, idx) => (
                    <span key={idx} className="chip danger">{keyword}</span>
                  ))
                )}
              </div>
            </div>

            <div className="status-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                <div style={{ fontWeight: 800 }}>💡 Suggestions</div>
                <span className="chip info">Actionable</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--muted)', lineHeight: 1.8, fontSize: '13px' }}>
                {result.suggestions.map((suggestion, idx) => (
                  <li key={idx}>{suggestion}</li>
                ))}
              </ul>
            </div>

            <div className="status-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                <div style={{ fontWeight: 800 }}>📄 Generate documents</div>
                <span className={applicationStatus === 'applied' ? 'chip success' : 'chip'}>
                  {applicationStatus ? applicationStatus : 'not tracked'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  className="btn btn-primary btn-block"
                  onClick={generateOptimizedResume}
                  disabled={generatingResume || !canGenerateResume}
                >
                  {generatingResume ? 'Generating…' : 'Remake Resume'}
                </button>
                <button
                  className="btn btn-secondary btn-block"
                  onClick={generateCoverLetter}
                  disabled={generatingCover}
                >
                  {generatingCover ? 'Generating…' : 'Create Cover Letter'}
                </button>
              </div>

              {(optimizedResume || coverLetter) && (
                <div style={{ marginTop: '12px', display: 'grid', gap: '12px' }}>
                  {optimizedResume && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 800 }}>
                            Optimized resume 
                            <span style={{ fontWeight: 400, marginLeft: '8px', fontSize: '11px', color: 'var(--muted)' }}>
                                {new Date(optimizedResume.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {(() => {
                            const isDocx = (resume.originalFileName || '').toLowerCase().endsWith('.docx');
                            return (
                              <>
                          <button className="btn btn-sm btn-secondary" onClick={() => downloadTxt(`${resume.name}-${job.company}-${job.title}-resume.txt`, optimizedResume.text)}>
                            TXT
                          </button>
                          {!isDocx && (
                            <button className="btn btn-sm btn-secondary" onClick={() => downloadDoc(`${resume.name}-${job.company}-${job.title}-resume.doc`, `Resume — ${job.title} @ ${job.company}`, optimizedResume.text)}>
                              Word
                            </button>
                          )}
                          {!isDocx && (
                            <button className="btn btn-sm btn-primary" onClick={() => void downloadPdf(`${resume.name}-${job.company}-${job.title}-resume.pdf`, `Resume — ${job.title} @ ${job.company}`, optimizedResume.text)}>
                              PDF
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-secondary"
                            title="Download a real .docx while preserving your original DOCX formatting"
                            onClick={() => void downloadOptimizedDocxPreservingFormat(optimizedResume.text)}
                          >
                            DOCX (original format)
                          </button>
                          <button
                            className="btn btn-sm btn-primary"
                            title="Analyze this new resume against the job"
                            onClick={() => analyzeMatch(optimizedResume.text)}
                          >
                            ⟳ Rematch
                          </button>
                          {resume.originalFileUrl && (
                            <button
                              className="btn btn-sm btn-secondary"
                              title="Open the exact file you uploaded (original formatting)"
                              onClick={() => void chrome.tabs.create({ url: resume.originalFileUrl! })}
                            >
                              Original file
                            </button>
                          )}
                           <button
                             className="icon-button"
                             title="Delete optimized resume"
                             onClick={() => handleDeleteOptimizedResume(optimizedResume.id)}
                             style={{ color: 'var(--danger)', marginLeft: '4px' }}
                           >
                            🗑
                           </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <textarea className="form-textarea" readOnly value={optimizedResume.text} style={{ minHeight: '140px' }} />
                    </div>
                  )}

                  {coverLetter && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 800 }}>
                            Cover letter
                            <span style={{ fontWeight: 400, marginLeft: '8px', fontSize: '11px', color: 'var(--muted)' }}>
                                {new Date(coverLetter.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => downloadDoc(`${job.company}-${job.title}-cover-letter.doc`, `Cover Letter — ${job.title} @ ${job.company}`, coverLetter.text)}>
                            Word
                          </button>
                          <button className="btn btn-sm btn-secondary" onClick={() => void downloadPdf(`${job.company}-${job.title}-cover-letter.pdf`, `Cover Letter — ${job.title} @ ${job.company}`, coverLetter.text)}>
                            PDF
                          </button>
                           <button
                             className="icon-button"
                             title="Delete cover letter"
                             onClick={() => handleDeleteCoverLetter(coverLetter.id)}
                             style={{ color: 'var(--danger)', marginLeft: '4px' }}
                           >
                            🗑
                           </button>
                        </div>
                      </div>
                      <textarea className="form-textarea" readOnly value={coverLetter.text} style={{ minHeight: '140px' }} />
                    </div>
                  )}

                  {applicationStatus && applicationStatus !== 'draft' ? (
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label style={{ fontWeight: 800 }}>Current Status</label>
                        {saving && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Updating...</span>}
                      </div>
                      <select
                        style={{
                           width: '100%',
                           padding: '10px',
                           borderRadius: '6px',
                           border: '1px solid var(--border)',
                           background: 'rgba(0,0,0,0.2)',
                           color: 'var(--text)',
                           fontSize: '14px',
                           outline: 'none',
                           appearance: 'none',
                           cursor: 'pointer'
                        }}
                        value={applicationStatus}
                        onChange={(e) => ensureApplication({ jobId: job.id, status: e.target.value as any })}
                        disabled={saving}
                      >
                        <option value="applied">Applied</option>
                        <option value="interviewing">Interviewing</option>
                        <option value="accepted">Accepted</option>
                        <option value="rejected">Rejected</option>
                      </select>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.4 }}>
                        Update the status as you progress through the hiring process.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <button className="btn btn-secondary btn-block" onClick={() => ensureApplication({ jobId: job.id, status: 'draft' })} disabled={saving}>
                        {saving ? 'Saving...' : 'Save as Draft'}
                        </button>
                        <button className="btn btn-primary btn-block" onClick={markApplied} disabled={saving}>
                        {saving ? 'Saving...' : 'Mark as Applied'}
                        </button>
                    </div>
                  )}

                  <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
                    Saved locally and linked to this job. View anytime in Dashboard.
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button className="btn btn-secondary btn-block" onClick={analyzeMatch} disabled={loading}>
                Re-run
              </button>
              <button className="btn btn-primary btn-block" onClick={onBack}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {rewriteOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rewrite resume">
          <div className="modal">
            <div className="modal-header">
              <div style={{ display: 'grid', gap: '4px' }}>
                <div style={{ fontWeight: 900 }}>
                  {rewriteType === 'resume' ? 'Rewriting your resume' : 'Creating your cover letter'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {rewriteStatus === 'generating' ? 'Generating…' : rewriteStatus === 'typing' ? 'Writing…' : rewriteStatus === 'done' ? 'Ready' : rewriteStatus === 'cancelled' ? 'Cancelled' : rewriteStatus === 'error' ? 'Error' : ''}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {(rewriteStatus === 'generating' || rewriteStatus === 'typing') && (
                  <button className="btn btn-sm btn-secondary" onClick={cancelRewrite}>
                    Cancel
                  </button>
                )}
                <button className="icon-button" onClick={closeRewriteModal} title="Close" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            <div className="modal-body" ref={generatedTextareaRef}>
              {rewriteError && (
                <div className="alert warning" style={{ marginBottom: '12px' }}>
                  <span className="alert-icon">⚠️</span>
                  <div>
                    <strong>Rewrite issue</strong>
                    <p>{rewriteError}</p>
                  </div>
                </div>
              )}

              {(rewriteStatus === 'generating' && !rewriteDisplayedText) && (
                <div className="status-card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="spinner" />
                    <div style={{ display: 'grid', gap: '6px' }}>
                      <div style={{ fontWeight: 800 }}>Working on it…</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Keeping your DOCX formatting intact.</div>
                    </div>
                  </div>
                </div>
              )}

              {(rewriteDisplayedText || rewriteFullText) && (
                <pre className="modal-pre">
                  {rewriteDisplayedText || rewriteFullText}
                  {(rewriteStatus === 'typing' || rewriteStatus === 'generating') && <span className="typing-cursor" />}
                </pre>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeRewriteModal}>
                Close
              </button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-success"
                  disabled={!rewriteFullText || rewriteStatus === 'generating' || rewriteStatus === 'typing' || saving}
                  onClick={() => void saveGeneratedContent()}
                >
                  {saving ? 'Saving…' : 'Save to Database'}
                </button>
                
                {(() => {
                    const isDocx = (resume.originalFileName || '').toLowerCase().endsWith('.docx');
                    return (
                        <button
                          className="btn btn-primary"
                          disabled={!rewriteFullText || rewriteStatus === 'generating' || rewriteStatus === 'typing'}
                          onClick={() => {
                              if (isDocx) void downloadOptimizedDocxPreservingFormat(rewriteFullText);
                              else downloadDoc(`${resume.name}-${job.company}-${job.title}-resume.doc`, `Resume`, rewriteFullText);
                          }}
                        >
                          {isDocx ? "Download DOCX" : "Download Word"}
                        </button>
                    );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobAnalysis;
