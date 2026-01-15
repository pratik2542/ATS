import React, { useState, useEffect } from 'react';
import { Application, JobPosting, OptimizedResume, CoverLetter, Resume } from '../../types';
import { downloadDoc, downloadPdf } from '../utils/download';
import { isFirebaseEnabled } from '../../firebase/firebase';
import { tryCloudDeleteApplication, tryCloudDeleteCoverLetter, tryCloudDeleteOptimizedResume, tryCloudPullAllToLocal, tryCloudPushAllFromLocal } from '../../firebase/sync';

interface DashboardProps {
  onBack: () => void;
  onDataChanged?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onBack, onDataChanged }) => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [optimizedResumes, setOptimizedResumes] = useState<OptimizedResume[]>([]);
  const [coverLetters, setCoverLetters] = useState<CoverLetter[]>([]);
  const [view, setView] = useState<'applications' | 'resumes' | 'letters'>('applications');
  const [cloudSync, setCloudSync] = useState<{ uid?: string; lastPushAt?: number; lastPullAt?: number; lastError?: string; lastErrorAt?: number }>({});
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    chrome.storage.local.get(
      ['applications', 'jobs', 'resumes', 'optimizedResumes', 'coverLetters', 'cloudSync'],
      (result) => {
        setApplications(result.applications || []);
        setJobs(result.jobs || []);
        setResumes(result.resumes || []);
        setOptimizedResumes(result.optimizedResumes || []);
        setCoverLetters(result.coverLetters || []);
        setCloudSync(result.cloudSync || {});
      }
    );
  };

  const formatDateTime = (timestamp?: number): string => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await tryCloudPullAllToLocal();
      loadData();
    } catch (e) {
      console.warn('Cloud pull failed:', e);
      loadData();
    } finally {
      setSyncing(false);
    }
  };

  const handlePushLocal = async () => {
    setSyncing(true);
    try {
      await tryCloudPushAllFromLocal();
      loadData();
    } catch (e) {
      console.warn('Cloud push failed:', e);
      loadData();
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteDraftApplication = async (appId: string) => {
    if (!confirm('Delete this draft application?')) return;
    
    setSyncing(true);
    try {
      // Delete from cloud FIRST and WAIT for completion
      try {
        await tryCloudDeleteApplication(appId);
      } catch (e) {
        console.error('Cloud delete failed for application', appId, e);
        throw e;
      }

      const result = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['applications'], resolve);
      });
      
      const updated = (result.applications || []).filter((a: Application) => a.id !== appId);
      
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ applications: updated }, () => {
          resolve();
        });
      });
      
      loadData();
      onDataChanged?.();
    } catch (e) {
      console.error('Delete draft application failed:', e);
      alert('❌ Delete failed: ' + (e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = async (appId: string, newStatus: string) => {
    setSyncing(true);
    try {
      const result = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['applications'], resolve);
      });
      
      const apps: Application[] = result.applications || [];
      const appIndex = apps.findIndex((a: Application) => a.id === appId);
      
      if (appIndex === -1) {
        throw new Error('Application not found');
      }

      apps[appIndex] = {
        ...apps[appIndex],
        status: newStatus as any,
      };
      
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ applications: apps }, () => {
          resolve();
        });
      });
      
      loadData();
      onDataChanged?.();
    } catch (e) {
      console.error('Status update failed:', e);
      alert('❌ Status update failed: ' + (e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const getJobById = (jobId: string): JobPosting | undefined => {
    return jobs.find(j => j.id === jobId);
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const counts = {
    total: applications.length,
    applied: applications.filter(a => a.status === 'applied').length,
    interviewing: applications.filter(a => a.status === 'interviewing').length,
    accepted: applications.filter(a => a.status === 'accepted').length,
    rejected: applications.filter(a => a.status === 'rejected').length,
  };

  const last7Days = (() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);

    const buckets = new Array(7).fill(0);
    for (const app of applications) {
      const d = new Date(app.appliedDate);
      d.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((d.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0 && diffDays < 7) buckets[diffDays] += 1;
    }

    const max = Math.max(1, ...buckets);
    const labels = buckets.map((_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day.toLocaleDateString('en-US', { weekday: 'short' });
    });

    return { buckets, max, labels };
  })();

  const downloadResumeDoc = (resume: OptimizedResume, jobTitle: string, company: string) =>
    downloadDoc(`${resume.name}.doc`, `Resume — ${jobTitle} @ ${company}`, resume.parsedText);
  const downloadResumePdf = (resume: OptimizedResume, jobTitle: string, company: string) =>
    void downloadPdf(`${resume.name}.pdf`, `Resume — ${jobTitle} @ ${company}`, resume.parsedText);

  const downloadCoverLetterDoc = (letter: CoverLetter, jobTitle: string, company: string) =>
    downloadDoc(`Cover_Letter_${jobTitle}.doc`, `Cover Letter — ${jobTitle} @ ${company}`, letter.content);
  const downloadCoverLetterPdf = (letter: CoverLetter, jobTitle: string, company: string) =>
    void downloadPdf(`Cover_Letter_${jobTitle}.pdf`, `Cover Letter — ${jobTitle} @ ${company}`, letter.content);

  const handleDeleteOptimizedResume = async (resumeId: string) => {
    if (!window.confirm('⚠️ DELETE FROM DATABASE?\n\nThis will permanently remove this resume from both local storage and cloud database.')) return;
    
    try {
      await tryCloudDeleteOptimizedResume(resumeId);
      
      const updated = optimizedResumes.filter(r => r.id !== resumeId);
      setOptimizedResumes(updated);
      
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ optimizedResumes: updated }, resolve);
      });
    } catch (e) {
      console.error('Delete failed:', e);
      alert('❌ Delete failed: ' + (e as Error).message);
    }
  };

  const handleDeleteCoverLetter = async (letterId: string) => {
    if (!window.confirm('⚠️ DELETE FROM DATABASE?\n\nThis will permanently remove this cover letter from both local storage and cloud database.')) return;
    
    try {
      await tryCloudDeleteCoverLetter(letterId);
      
      const updated = coverLetters.filter(l => l.id !== letterId);
      setCoverLetters(updated);
      
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ coverLetters: updated }, resolve);
      });
    } catch (e) {
      console.error('Delete failed:', e);
      alert('❌ Delete failed: ' + (e as Error).message);
    }
  };

  const openOriginalResume = async (resume: Resume): Promise<void> => {
    const url = resume.originalFileUrl;
    if (!url) return;

    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) {
        const cldError = head.headers.get('x-cld-error');
        const hint = cldError ? `\nCloudinary says: ${cldError}` : '';
        alert(
          `This Cloudinary file is not publicly accessible (HTTP ${head.status}).${hint}\n\nFix: disable Cloudinary access control / restricted media for this preset or account, then re-upload the resume.`
        );
        return;
      }
    } catch {
      // Ignore preflight errors (some browsers/extensions block HEAD). We'll try opening anyway.
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        await chrome.tabs.create({ url });
        return;
      }
    } catch (e) {
      console.warn('Failed to open in new tab:', e);
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <div className="header">
        <button className="back-button" onClick={onBack}>
          ← Back
        </button>
        <div className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">Dashboard</h1>
            <p className="topbar-subtitle">Track your pipeline and documents</p>
          </div>
          <div className="topbar-actions">
            <span className="pill" title="Last 7 days activity">
              <span className="pill-dot" />
              Activity
            </span>
          </div>
        </div>
      </div>

      <div className="content">
        <div className="status-card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: '4px' }}>Cloud Sync</div>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                {isFirebaseEnabled() ? 'Enabled' : 'Disabled (missing .env Firebase config)'}
                {cloudSync.uid ? ` • UID: ${cloudSync.uid.slice(0, 8)}…` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-sm btn-secondary" disabled={!isFirebaseEnabled() || syncing} onClick={() => void handlePushLocal()}>
                {syncing ? 'Syncing…' : 'Push'}
              </button>
              <button className="btn btn-sm btn-primary" disabled={!isFirebaseEnabled() || syncing} onClick={() => void handleSyncNow()}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '8px', marginTop: '10px', fontSize: '12px', color: 'var(--muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Last pull</span>
              <span>{formatDateTime(cloudSync.lastPullAt)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Last push</span>
              <span>{formatDateTime(cloudSync.lastPushAt)}</span>
            </div>
            {cloudSync.lastError && (
              <div style={{ marginTop: '6px' }}>
                <span style={{ color: 'var(--danger)' }}>Last error:</span> {cloudSync.lastError}
              </div>
            )}
          </div>
        </div>

        <div className="kpi-grid" style={{ marginBottom: '14px' }}>
          <div className="kpi">
            <div className="kpi-value">{counts.total}</div>
            <div className="kpi-label">Applications</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{counts.interviewing}</div>
            <div className="kpi-label">Interviews</div>
          </div>
        </div>

        <div className="status-card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: '4px' }}>Pipeline</div>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Applied → Interview → Offer</div>
            </div>
            <span className="chip info">{counts.accepted} accepted</span>
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                <span>Applied</span>
                <span>{counts.applied}</span>
              </div>
              <div className="progress"><span style={{ width: `${counts.total ? (counts.applied / counts.total) * 100 : 0}%` }} /></div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                <span>Interviewing</span>
                <span>{counts.interviewing}</span>
              </div>
              <div className="progress"><span style={{ width: `${counts.total ? (counts.interviewing / counts.total) * 100 : 0}%` }} /></div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                <span>Accepted</span>
                <span>{counts.accepted}</span>
              </div>
              <div className="progress"><span style={{ width: `${counts.total ? (counts.accepted / counts.total) * 100 : 0}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="status-card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: '4px' }}>Last 7 days</div>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Applications per day</div>
            </div>
            <span className="chip">{last7Days.buckets.reduce((a, b) => a + b, 0)} total</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', alignItems: 'end' }}>
            {last7Days.buckets.map((n, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                <div
                  title={`${last7Days.labels[i]}: ${n}`}
                  style={{
                    width: '100%',
                    height: `${Math.max(10, Math.round((n / last7Days.max) * 54))}px`,
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.85) 0%, rgba(6, 182, 212, 0.35) 100%)',
                  }}
                />
                <div style={{ fontSize: '10px', color: 'var(--muted2)' }}>{last7Days.labels[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="kpi-grid" style={{ marginBottom: '14px' }}>
          <div className="kpi">
            <div className="kpi-value">{optimizedResumes.length}</div>
            <div className="kpi-label">Optimized Resumes</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{coverLetters.length}</div>
            <div className="kpi-label">Cover Letters</div>
          </div>
        </div>

        <div className="segmented" style={{ marginBottom: '14px' }}>
          <button
            className={`segmented-btn ${view === 'applications' ? 'active' : ''}`}
            onClick={() => setView('applications')}
          >
            Applications
          </button>
          <button
            className={`segmented-btn ${view === 'resumes' ? 'active' : ''}`}
            onClick={() => setView('resumes')}
          >
            Resumes
          </button>
          <button
            className={`segmented-btn ${view === 'letters' ? 'active' : ''}`}
            onClick={() => setView('letters')}
          >
            Letters
          </button>
        </div>

        {view === 'applications' && (
          <div>
            {applications.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <p>No applications yet</p>
              </div>
            ) : (
              applications.map(app => {
                const job = getJobById(app.jobId);
                return (
                  <div key={app.id} className="list-item">
                    <div className="list-item-content">
                      <h4>{job?.title || 'Unknown Position'}</h4>
                      <p>{job?.company || 'Unknown Company'} • {formatDate(app.appliedDate)}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {app.status === 'draft' ? (
                        <>
                          <span className="badge">draft</span>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => void handleDeleteDraftApplication(app.id)}
                            style={{ padding: '4px 8px' }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <select
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            background: app.status === 'applied' ? 'rgba(6, 182, 212, 0.15)' :
                                       app.status === 'interviewing' ? 'rgba(251, 191, 36, 0.15)' :
                                       app.status === 'accepted' ? 'rgba(34, 197, 94, 0.15)' :
                                       'rgba(251, 113, 133, 0.15)',
                            color: app.status === 'applied' ? 'var(--accent3)' :
                                   app.status === 'interviewing' ? 'var(--warning)' :
                                   app.status === 'accepted' ? 'var(--accent2)' :
                                   'var(--danger)',
                            fontSize: '12px',
                            fontWeight: 600,
                            outline: 'none',
                            cursor: 'pointer',
                            textTransform: 'capitalize'
                          }}
                          value={app.status}
                          onChange={(e) => void handleStatusChange(app.id, e.target.value)}
                          disabled={syncing}
                        >
                          <option value="applied">Applied</option>
                          <option value="interviewing">Interviewing</option>
                          <option value="accepted">Accepted</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {view === 'resumes' && (
          <div>
            {resumes.length === 0 && optimizedResumes.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📄</div>
                <p>No resumes yet</p>
              </div>
            ) : (
              <>
                {resumes.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontWeight: 800, marginBottom: '10px' }}>Uploaded resumes</div>
                    {resumes
                      .slice()
                      .sort((a, b) => (b.uploadDate || 0) - (a.uploadDate || 0))
                      .map((r) => (
                        <div key={r.id} className="list-item">
                          <div className="list-item-content">
                            <h4>{r.name}</h4>
                            <p>{formatDate(r.uploadDate)} {r.isDefault ? '• Default' : ''}</p>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {r.originalFileUrl ? (
                              <button className="btn btn-sm btn-primary" onClick={() => void openOriginalResume(r)}>
                                Original
                              </button>
                            ) : (
                              <button className="btn btn-sm btn-secondary" disabled title="Upload again after Cloudinary is enabled to store the original file">
                                Original
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                <div>
                  <div style={{ fontWeight: 800, marginBottom: '10px' }}>Optimized resumes</div>
                  {optimizedResumes.length === 0 ? (
                    <div className="empty-state" style={{ marginBottom: '12px' }}>
                      <div className="empty-state-icon">✨</div>
                      <p>No optimized resumes yet</p>
                    </div>
                  ) : (
                    optimizedResumes.map(resume => {
                      const job = getJobById(resume.jobId);
                      return (
                        <div key={resume.id} className="list-item">
                          <div className="list-item-content">
                            <h4>{resume.name}</h4>
                            <p>{job?.company || 'Unknown'} • {formatDate(resume.uploadDate)}</p>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-sm btn-secondary" onClick={() => downloadResumeDoc(resume, job?.title || 'Job', job?.company || 'Company')}>Word</button>
                            <button className="btn btn-sm btn-primary" onClick={() => downloadResumePdf(resume, job?.title || 'Job', job?.company || 'Company')}>PDF</button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteOptimizedResume(resume.id)} title="Delete">
                              🗑️
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {view === 'letters' && (
          <div>
            {coverLetters.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">✉️</div>
                <p>No cover letters yet</p>
              </div>
            ) : (
              coverLetters.map(letter => {
                const job = getJobById(letter.jobId);
                return (
                  <div key={letter.id} className="list-item">
                    <div className="list-item-content">
                      <h4>{job?.title || 'Cover Letter'}</h4>
                      <p>{job?.company || 'Unknown'} • {formatDate(letter.createdDate)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => downloadCoverLetterDoc(letter, job?.title || 'Job', job?.company || 'Company')}>Word</button>
                      <button className="btn btn-sm btn-primary" onClick={() => downloadCoverLetterPdf(letter, job?.title || 'Job', job?.company || 'Company')}>PDF</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCoverLetter(letter.id)} title="Delete">
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
