import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Resume, JobPosting, Application } from '../types';
import ResumeUpload from '@/popup/components/ResumeUpload';
import JobAnalysis from '@/popup/components/JobAnalysis';
import Dashboard from '@/popup/components/Dashboard';
import Settings from '@/popup/components/Settings';
import './popup.css';
import { tryCloudPullAllToLocal } from '@/firebase/sync';
import { getFirebaseAuth, isFirebaseEnabled } from '@/firebase/firebase';
import { onAuthStateChanged } from 'firebase/auth';

type View = 'home' | 'upload' | 'analyze' | 'dashboard' | 'settings';
type NavView = 'home' | 'upload' | 'dashboard' | 'settings';

type SettingsState = {
  openaiApiKey: string;
  geminiApiKey: string;
  aiProvider: 'openai' | 'gemini';
};

const Popup: React.FC = () => {
  const [view, setView] = useState<View>('home');
  const [defaultResume, setDefaultResume] = useState<Resume | null>(null);
  const [currentJob, setCurrentJob] = useState<JobPosting | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [settings, setSettings] = useState<SettingsState>({
    openaiApiKey: '',
    geminiApiKey: '',
    aiProvider: 'openai'
  });

  useEffect(() => {
    // Load data from storage
    try {
      chrome.storage.local.get(['resumes', 'applications', 'settings', 'apiKey'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Storage error:', chrome.runtime.lastError);
          return;
        }
        
        const resumes: Resume[] = result.resumes || [];
        const defaultRes = resumes.find(r => r.isDefault);
        setDefaultResume(defaultRes || null);
        setApplications(result.applications || []);
        
        // Migrate old apiKey to settings if needed
        if (result.apiKey && !result.settings) {
          setSettings({
            openaiApiKey: result.apiKey,
            geminiApiKey: '',
            aiProvider: 'openai'
          });
        } else {
          setSettings(result.settings || {
            openaiApiKey: '',
            geminiApiKey: '',
            aiProvider: 'openai'
          });
        }
      });
    } catch (error) {
      console.error('Failed to load storage:', error);
    }

    // Best-effort cloud pull to hydrate local storage (does not block UX),
    // but ONLY if a user is already signed in. Never auto-create anonymous users.
    try {
      if (isFirebaseEnabled()) {
        const auth = getFirebaseAuth();
        if (auth) {
          const unsub = onAuthStateChanged(auth, (u) => {
            if (u) {
              void tryCloudPullAllToLocal().catch((e) => console.warn('Cloud sync pull failed:', e));
            }
            unsub();
          });
        }
      }
    } catch (e) {
      console.warn('Cloud sync init failed:', e);
    }

    // Check if we're on a job posting page
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          console.error('Tabs query error:', chrome.runtime.lastError);
          return;
        }
        
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { type: 'REQUEST_JOB_EXTRACTION' },
            (response) => {
              if (chrome.runtime.lastError) {
                // Ignore - content script might not be injected
                return;
              }
              
              if (response?.success && response.job) {
                const extractedJob: JobPosting = response.job;

                // Persist job by URL so jobId stays stable across sessions.
                chrome.storage.local.get(['jobs'], (r) => {
                  if (chrome.runtime.lastError) {
                    console.error('Storage error:', chrome.runtime.lastError);
                    return;
                  }
                  
                  const jobs: JobPosting[] = r.jobs || [];
                  const existing = jobs.find((j) => j.url === extractedJob.url);
                  if (existing) {
                    setCurrentJob(existing);
                    return;
                  }

                  jobs.push(extractedJob);
                  chrome.storage.local.set({ jobs }, () => {
                    if (chrome.runtime.lastError) {
                      console.error('Storage error:', chrome.runtime.lastError);
                      return;
                    }
                    setCurrentJob(extractedJob);
                  });
                });
              }
            }
          );
        }
      });
    } catch (error) {
      console.error('Failed to query tabs:', error);
    }
  }, []);

  const handleResumeUploaded = (resume: Resume) => {
    setDefaultResume(resume);
    setView('home');
  };

  const handleSettingsSave = (newSettings: SettingsState) => {
    setSettings(newSettings);
    chrome.storage.local.set({ settings: newSettings });
  };

  const reloadApplicationsData = () => {
    chrome.storage.local.get(['applications'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Storage error:', chrome.runtime.lastError);
        return;
      }
      setApplications(result.applications || []);
    });
  };

  const activeNav: NavView =
    view === 'analyze' ? 'home' :
    view === 'home' ? 'home' :
    view === 'upload' ? 'upload' :
    view === 'dashboard' ? 'dashboard' :
    'settings';

  return (
    <div className="popup-container">
      {view === 'home' && (
        <HomeView
          defaultResume={defaultResume}
          currentJob={currentJob}
          applications={applications}
          settings={settings}
          onNavigate={setView}
        />
      )}
      {view === 'upload' && (
        <ResumeUpload
          onBack={() => setView('home')}
          onResumeUploaded={handleResumeUploaded}
        />
      )}
      {view === 'analyze' && currentJob && defaultResume && (
        <JobAnalysis
          resume={defaultResume}
          job={currentJob}
          settings={settings}
          onBack={() => setView('home')}
        />
      )}
      {view === 'dashboard' && (
        <Dashboard
          onBack={() => setView('home')}
          onDataChanged={reloadApplicationsData}
        />
      )}
      {view === 'settings' && (
        <Settings
          settings={settings}
          onSettingsSave={handleSettingsSave}
          onBack={() => setView('home')}
        />
      )}

      <BottomNav
        active={activeNav}
        onNavigate={(next) => setView(next)}
      />
    </div>
  );
};

const BottomNav: React.FC<{ active: NavView; onNavigate: (view: NavView) => void }> = ({ active, onNavigate }) => {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <button
        type="button"
        className={`nav-item ${active === 'home' ? 'active' : ''}`}
        onClick={() => onNavigate('home')}
        aria-current={active === 'home' ? 'page' : undefined}
      >
        <span className="nav-icon" aria-hidden="true">⌂</span>
        <span className="nav-label">Home</span>
      </button>

      <button
        type="button"
        className={`nav-item ${active === 'dashboard' ? 'active' : ''}`}
        onClick={() => onNavigate('dashboard')}
        aria-current={active === 'dashboard' ? 'page' : undefined}
      >
        <span className="nav-icon" aria-hidden="true">▦</span>
        <span className="nav-label">Dash</span>
      </button>

      <button
        type="button"
        className={`nav-item ${active === 'upload' ? 'active' : ''}`}
        onClick={() => onNavigate('upload')}
        aria-current={active === 'upload' ? 'page' : undefined}
      >
        <span className="nav-icon" aria-hidden="true">⤒</span>
        <span className="nav-label">Upload</span>
      </button>

      <button
        type="button"
        className={`nav-item ${active === 'settings' ? 'active' : ''}`}
        onClick={() => onNavigate('settings')}
        aria-current={active === 'settings' ? 'page' : undefined}
      >
        <span className="nav-icon" aria-hidden="true">⚙</span>
        <span className="nav-label">Settings</span>
      </button>
    </nav>
  );
};

interface HomeViewProps {
  defaultResume: Resume | null;
  currentJob: JobPosting | null;
  applications: Application[];
  settings: SettingsState;
  onNavigate: (view: View) => void;
}

const HomeView: React.FC<HomeViewProps> = ({
  defaultResume,
  currentJob,
  applications,
  settings,
  onNavigate
}) => {
  const hasActiveKey = settings.aiProvider === 'openai' ? !!settings.openaiApiKey : !!settings.geminiApiKey;
  const providerLabel = settings.aiProvider === 'openai' ? 'OpenAI' : 'Gemini';
  const providerDotClass = hasActiveKey ? 'pill-dot' : 'pill-dot warning';

  return (
    <div className="home-view">
      <div className="header">
        <div className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">ATS Resume Tracker</h1>
            <p className="topbar-subtitle">AI-powered job assistant</p>
          </div>
          <div className="topbar-actions">
            <span className="pill" title="Active AI provider">
              <span className={providerDotClass} />
              {providerLabel}
            </span>
            <button
              className="icon-button"
              onClick={() => onNavigate('settings')}
              title="Settings"
              aria-label="Settings"
            >
              ⚙️
            </button>
          </div>
        </div>
      </div>

      <div className="content">
        {!hasActiveKey && (
          <div className="alert warning">
            <span className="alert-icon">⚠️</span>
            <div>
              <strong>Setup required</strong>
              <p>Add your {providerLabel} API key in settings to enable analysis.</p>
            </div>
          </div>
        )}

        <div className="status-card">
          <div className="status-item">
            <span className="status-label">Default Resume</span>
            <span className="status-value">
              {defaultResume ? `✓ ${defaultResume.name}` : '✗ Not Set'}
            </span>
          </div>
          {defaultResume ? (
            <button
              className="btn btn-secondary btn-block"
              onClick={() => onNavigate('upload')}
            >
              Upload New Resume
            </button>
          ) : (
            <button
              className="btn btn-primary btn-block"
              onClick={() => onNavigate('upload')}
            >
              Upload Your Resume
            </button>
          )}
        </div>

        {currentJob && (
          <div className="job-card">
            <div className="job-icon">💼</div>
            <div className="job-info">
              <h3>{currentJob.title}</h3>
              <p>{currentJob.company}</p>
            </div>
            {defaultResume && hasActiveKey && (
              <button
                className="btn btn-primary"
                onClick={() => onNavigate('analyze')}
              >
                Analyze Match
              </button>
            )}
          </div>
        )}

        {!currentJob && (
          <div className="info-card">
            <span className="info-icon">ℹ️</span>
            <p>Navigate to a job posting page to analyze your resume match!</p>
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{applications.length}</div>
            <div className="stat-label">Applications</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">
              {applications.filter(a => a.status === 'interviewing').length}
            </div>
            <div className="stat-label">Interviews</div>
          </div>
        </div>

        <div className="menu-grid">
          <button
            className="menu-item"
            onClick={() => onNavigate('dashboard')}
          >
            <span className="menu-icon">📊</span>
            <span>Dashboard</span>
          </button>
          <button
            className="menu-item"
            onClick={() => onNavigate('upload')}
          >
            <span className="menu-icon">📄</span>
            <span>Upload Resume</span>
          </button>
          <button
            className="menu-item"
            onClick={() => onNavigate('settings')}
          >
            <span className="menu-icon">⚙️</span>
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// Error boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'white' }}>
          <h2>Something went wrong</h2>
          <pre style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Mount React app
try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ErrorBoundary>
      <Popup />
    </ErrorBoundary>
  );
} catch (error) {
  console.error('Failed to mount React app:', error);
  document.body.innerHTML = `<div style="padding: 20px; color: white;"><h2>Failed to initialize</h2><pre>${error}</pre></div>`;
}

